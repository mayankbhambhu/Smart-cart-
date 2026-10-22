"""Ask SmartCart: a shopping assistant that answers only from the store's own data.

This is the capstone's "AI assistance with guardrails" in code:
- Retrieval first. We look the question up in the catalogue and inventory ourselves and hand the
  model only those facts ("approved knowledge"). It has no tools and cannot buy, price or reserve.
- The system prompt forbids answering beyond the facts; with no match, it must say it is not sure
  and offer floor help, never invent a location, price or stock level.
- Without an API key, or if the model declines, the same facts are turned into a plain answer by
  rules, so the feature works in demos and never blocks a shopper.
"""

import logging
import re
from collections.abc import Awaitable, Callable
from typing import Any

import anthropic
from sqlalchemy.ext.asyncio import AsyncSession

from .assist_service import AssistService, query_words
from .errors import ApiError

log = logging.getLogger("smartcart.assistant")

MODEL = "claude-opus-5-5"
MAX_FACTS = 12
_STOPWORDS = {
    "where",
    "what",
    "which",
    "who",
    "how",
    "much",
    "many",
    "is",
    "are",
    "the",
    "a",
    "an",
    "do",
    "does",
    "you",
    "have",
    "has",
    "can",
    "could",
    "i",
    "me",
    "my",
    "find",
    "get",
    "buy",
    "want",
    "need",
    "for",
    "in",
    "on",
    "of",
    "to",
    "any",
    "some",
    "there",
    "this",
    "that",
    "store",
    "shop",
    "please",
    "show",
    "cheapest",
    "cheaper",
    "best",
    "price",
    "cost",
    "stock",
    "available",
    "kya",
    "hai",
    "kahan",
    "milega",
    "with",
    "without",
    "and",
    "or",
    "it",
    "its",
    "be",
    "am",
    "should",
    "would",
    "like",
    "tell",
    "about",
}

SYSTEM_PROMPT = """You are SmartCart, the in-store shopping assistant for a DMart value-retail store in India.

You help shoppers find products, compare prices and plan their trip. Answer only from the STORE FACTS \
in the user's message, which come from the store's live catalogue and inventory.

Rules:
- Never state a product, aisle, shelf, price or stock level that is not in STORE FACTS.
- If STORE FACTS do not answer the question, say you are not sure and suggest tapping "Call for help" \
so a staff member can assist. Do not guess.
- Stock is "in stock", "running low" or "out of stock" exactly as given; if it says unknown, say you \
can't confirm stock.
- You cannot add items to the cart, take payment, change prices or reserve stock yourself. If asked to \
reserve, say the shopper can do it from Reserve for pickup in the app.
- Say a product is veg, non-veg or egg only from its "label" in STORE FACTS; if it says not labelled, \
say the pack label should be checked.
- Prices are in rupees. When comparing, use the per-kg, per-litre or per-piece price given.
- Reply in the shopper's language (English, Hindi or Hinglish), in at most 4 short sentences or a \
short list. No markdown headings."""

Complete = Callable[[str, list[dict[str, str]]], Awaitable[str | None]]


def _rupees(paise: int | None) -> str:
    return "?" if paise is None else f"₹{paise / 100:.2f}"


def fact_line(p: dict[str, Any]) -> str:
    stock = {"in_stock": "in stock", "low": "running low", "out": "out of stock"}.get(p["stock"], "unknown")
    where = f"aisle {p['aisle']}, shelf {p['shelf']}" if p["aisle"] else "location unknown"
    per_unit = f", {_rupees(p['unitPricePaise'])}/{p['unit']}" if p["unitPricePaise"] else ""
    diet = f", diet: {', '.join(p['dietTags'])}" if p["dietTags"] else ""
    label = {"veg": "veg", "non_veg": "non-veg", "egg": "egg", "not_food": "not food"}.get(
        p.get("foodType") or "", "not labelled"
    )
    return (
        f"- {p['name']} ({p['category']}): {where}; {_rupees(p['pricePaise'])} "
        f"(MRP {_rupees(p['mrpPaise'])}){per_unit}; {stock}; label: {label}{diet}"
    )


def rules_answer(products: list[dict[str, Any]]) -> str:
    """The no-AI answer: the top matches, stated plainly from the same facts."""
    if not products:
        return (
            "I couldn't find that in this store's catalogue, so I won't guess. "
            "Tap Call for help and a staff member will come to you."
        )
    lines = []
    for p in products[:3]:
        stock = {"in_stock": "in stock", "low": "running low", "out": "out of stock"}.get(
            p["stock"], "stock not confirmed"
        )
        where = f"aisle {p['aisle']}, shelf {p['shelf']}" if p["aisle"] else "location not mapped"
        lines.append(f"{p['name']}: {where}, {_rupees(p['pricePaise'])}, {stock}.")
    return " ".join(lines)


class Assistant:
    def __init__(self, assist: AssistService, api_key: str | None, complete: Complete | None = None) -> None:
        self.assist = assist
        self.client = anthropic.AsyncAnthropic(api_key=api_key) if api_key and complete is None else None
        self._complete = complete

    @property
    def mode(self) -> str:
        return "ai" if (self.client or self._complete) else "rules"

    async def retrieve(self, db: AsyncSession, store_id: str, message: str) -> list[dict[str, Any]]:
        """Products relevant to the question: each content word searched, ranked by words matched."""
        words = [w for w in query_words(message) if w not in _STOPWORDS and len(w) > 1]
        scored: dict[str, tuple[int, dict[str, Any]]] = {}
        for w in words[:5]:
            try:
                hits = await self.assist.search(db, store_id, w, limit=10, source=None)
            except ApiError:
                continue
            for h in hits:
                count, _ = scored.get(h["productId"], (0, h))
                scored[h["productId"]] = (count + 1, h)
        ranked = sorted(scored.values(), key=lambda s: (-s[0], s[1]["unitPricePaise"] or 1 << 30))
        best = ranked[0][0] if ranked else 0
        products = [p for n, p in ranked if n == best][:MAX_FACTS]
        await self.assist.log_search(db, store_id, message, "assistant", len(products))
        return products

    async def answer(
        self, db: AsyncSession, store_id: str, message: str, history: list[dict[str, str]]
    ) -> dict[str, Any]:
        message = message.strip()
        if not message or len(message) > 500:
            raise ApiError(400, "invalid_message")
        products = await self.retrieve(db, store_id, message)
        facts = "\n".join(fact_line(p) for p in products) or "(no matching products in this store)"
        prompt = f"STORE FACTS\n{facts}\n\nSHOPPER QUESTION\n{message}"
        turns = [
            {"role": h["role"], "content": h["content"][:1000]}
            for h in history[-6:]
            if h.get("role") in ("user", "assistant") and isinstance(h.get("content"), str)
        ]
        reply = None
        if self.mode == "ai":
            try:
                reply = await (self._complete or self._claude)(prompt, turns)
            except anthropic.APIError:
                log.exception("assistant call failed; answering by rules")
        return {
            "reply": reply or rules_answer(products),
            "mode": "ai" if reply else "rules",
            "products": products[:5],
        }

    async def _claude(self, prompt: str, turns: list[dict[str, str]]) -> str | None:
        assert self.client
        # History must start with a user turn and alternate; drop anything that would break that.
        while turns and turns[0]["role"] != "user":
            turns = turns[1:]
        messages: list[Any] = [*turns, {"role": "user", "content": prompt}]
        if len(messages) > 1 and messages[-2]["role"] == "user":
            messages = messages[:-2] + messages[-1:]
        response = await self.client.beta.messages.create(
            model=MODEL,
            max_tokens=2000,
            system=SYSTEM_PROMPT,
            messages=messages,
            output_config={"effort": "low"},
            # A declined request is re-run on Anthropic's recommended fallback model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if response.stop_reason == "refusal":
            return None
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        return re.sub(r"\n{3,}", "\n\n", text) or None
