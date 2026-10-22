"use client";

import type { OfferCreateRequest, StoreOffer } from "@smart-cart/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState, type FormEvent } from "react";
import { Badge, buttonCls, Card, inputCls, Loading, Notice, PageHead, primaryCls, type Tone } from "@/components/ui";
import { apiGet, apiPost, formatInr, STORE_ID, type InventoryItem } from "@/lib/api";
import { offersQuery } from "@/lib/queries";
import { dateTime, offerMessage } from "@/lib/team";

const statusTone: Record<StoreOffer["status"], Tone> = { running: "green", scheduled: "blue", ended: "grey" };
const statusLabel: Record<StoreOffer["status"], string> = { running: "Running", scheduled: "Starts later", ended: "Ended" };
const LENGTHS = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "30 days" },
];

type Message = { tone: "ok" | "error" | "info"; text: string };

/**
 * Aisle deals (US-08). A manager puts a product on offer for a set time; while it runs, its price
 * is the offer price in search, carts and checkout, and the app tells shoppers in that aisle. The
 * system never sets or changes an offer by itself.
 */
export default function OffersPage() {
  const queryClient = useQueryClient();
  const offers = useQuery(offersQuery());
  const [message, setMessage] = useState<Message | null>(null);
  const [made, setMade] = useState(0);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["offers", STORE_ID] });

  const end = useMutation({
    mutationFn: (o: StoreOffer) => apiPost<StoreOffer>(`/admin/v1/stores/${STORE_ID}/offers/${o.id}/end`, {}),
    onSuccess: (o) => setMessage({ tone: "info", text: `Ended “${o.title}”. ${o.name} is back to ${formatInr(o.regularPaise)}.` }),
    onError: (e) => setMessage({ tone: "error", text: offerMessage(e) }),
    onSettled: refresh,
  });

  return (
    <section className="space-y-5">
      <PageHead
        title="Offers"
        hint="Shoppers see a running offer's price everywhere, and get a nudge on their phone when their cart reaches its aisle. Only managers set offers."
      />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Offer</th>
                <th className="px-3 py-2">Where</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2">Runs</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {!offers.data && (
                <tr>
                  <td colSpan={6} className="px-3 py-4">
                    <Loading error={offers.error} />
                  </td>
                </tr>
              )}
              {offers.data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-slate-500">
                    No offers yet. Create one to tell shoppers about it in the aisle.
                  </td>
                </tr>
              )}
              {offers.data?.map((o) => (
                <tr key={o.id} className={`border-t border-slate-100 ${o.status === "ended" ? "text-slate-400" : ""}`}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{o.title}</span>
                    <span className="block text-xs text-slate-500">{o.name}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{o.aisle ? `Aisle ${o.aisle}, shelf ${o.shelf}` : "Not on a shelf"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    <span className="font-semibold">{formatInr(o.offerPricePaise)}</span>
                    {o.regularPaise !== null && (
                      <span className="block text-xs text-slate-500">
                        was <s>{formatInr(o.regularPaise)}</s>
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    {dateTime(o.startsAt)} to
                    <br />
                    {dateTime(o.endedAt ?? o.endsAt)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={statusTone[o.status]}>{statusLabel[o.status]}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {o.status !== "ended" && (
                      <button className={buttonCls} disabled={end.isPending} onClick={() => end.mutate(o)}>
                        End now
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <NewOffer
          key={made}
          onDone={(text) => {
            setMade((n) => n + 1);
            setMessage({ tone: "ok", text });
            refresh();
          }}
        />
      </div>
    </section>
  );
}

function NewOffer({ onDone }: { onDone: (text: string) => void }) {
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState<InventoryItem | null>(null);
  const [rupees, setRupees] = useState("");
  const [title, setTitle] = useState("");
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const q = useDeferredValue(search.trim());

  const matches = useQuery({
    queryKey: ["inventory", STORE_ID, q, false],
    queryFn: () =>
      apiGet<{ items: InventoryItem[] }>(`/admin/v1/stores/${STORE_ID}/inventory?${new URLSearchParams({ q, lowStockOnly: "false" })}`),
    enabled: q.length >= 2 && !product,
  });

  const paise = Math.round(Number(rupees) * 100);
  const regular = product?.pricePaise ?? null;
  const saving = regular !== null && paise > 0 && paise < regular ? regular - paise : null;

  const create = useMutation({
    mutationFn: (body: OfferCreateRequest) => apiPost<StoreOffer>(`/admin/v1/stores/${STORE_ID}/offers`, body),
    onSuccess: (o) => onDone(`“${o.title}” is live: ${o.name} at ${formatInr(o.offerPricePaise)} until ${dateTime(o.endsAt)}.`),
    onError: (e) => setError(offerMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!product) return setError("Pick a product from the list.");
    if (!(paise > 0)) return setError("Enter the offer price in rupees.");
    create.mutate({
      productId: product.productId,
      title: title.trim() || (saving ? `Save ${formatInr(saving)}` : "Offer"),
      offerPricePaise: paise,
      endsAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    });
  };

  return (
    <Card title="New offer" hint="Starts now. The price must be below the product's regular price.">
      <form onSubmit={submit} className="space-y-3 text-sm">
        <label className="block space-y-1">
          <span className="font-medium">Product</span>
          {product ? (
            <span className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5">
              <span>
                {product.name}
                <span className="block text-xs text-slate-500">
                  {formatInr(product.pricePaise)} · Aisle {product.aisle ?? "?"}, shelf {product.shelf ?? "?"}
                </span>
              </span>
              <button type="button" className={buttonCls} onClick={() => setProduct(null)}>
                Change
              </button>
            </span>
          ) : (
            <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or barcode" />
          )}
        </label>
        {!product && q.length >= 2 && (
          <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
            {!matches.data ? (
              <li className="px-2.5 py-2">
                <Loading error={matches.error} />
              </li>
            ) : matches.data.items.length === 0 ? (
              <li className="px-2.5 py-2 text-slate-500">Nothing matches “{q}”.</li>
            ) : (
              matches.data.items.slice(0, 8).map((i) => (
                <li key={i.productId}>
                  <button
                    type="button"
                    className="w-full px-2.5 py-1.5 text-left hover:bg-slate-50"
                    onClick={() => {
                      setProduct(i);
                      setSearch("");
                    }}
                  >
                    {i.name}
                    <span className="ml-1 text-xs text-slate-500">{formatInr(i.pricePaise)}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="font-medium">Offer price (₹)</span>
            <input className={inputCls} value={rupees} onChange={(e) => setRupees(e.target.value)} inputMode="decimal" placeholder="45.00" required />
          </label>
          <label className="space-y-1">
            <span className="font-medium">Runs for</span>
            <select className={inputCls} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {LENGTHS.map((l) => (
                <option key={l.days} value={l.days}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {saving !== null && (
          <p className="text-xs text-emerald-700">
            Shoppers save {formatInr(saving)} ({Math.round((saving / regular!) * 100)}% off).
          </p>
        )}
        <label className="block space-y-1">
          <span className="font-medium">What shoppers see</span>
          <input
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder={saving ? `Save ${formatInr(saving)}` : "Weekend biscuit deal"}
          />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <button className={primaryCls} disabled={create.isPending}>
          Start offer
        </button>
      </form>
    </Card>
  );
}
