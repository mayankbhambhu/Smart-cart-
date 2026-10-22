import type { SearchResult, StockStatus } from "@smart-cart/contracts";
import { formatInr } from "./money";

/** A pasted or typed list, one item per line or separated by commas. Bullets and blanks dropped. */
export function parseListText(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 60);
}

/** "2,000" or "₹1500.50" -> paise; null when it is not a positive amount. */
export function parseRupees(text: string): number | null {
  const cleaned = text.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const paise = Math.round(Number(cleaned) * 100);
  return paise > 0 ? paise : null;
}

export type BudgetState = { budgetPaise: number; spentPaise: number; leftPaise: number; ratio: number; over: boolean };

/** How the cart total compares with the shopper's budget (the deck's "money expenditure track"). */
export function budgetState(spentPaise: number, budgetPaise: number): BudgetState {
  return {
    budgetPaise,
    spentPaise,
    leftPaise: budgetPaise - spentPaise,
    ratio: Math.min(1, spentPaise / budgetPaise),
    over: spentPaise > budgetPaise,
  };
}

export const stockLabel: Record<StockStatus, string> = {
  in_stock: "In stock",
  low: "Running low",
  out: "Out of stock",
  unknown: "Stock not confirmed",
};

/** "₹52.00 / L" for comparing pack sizes, or null when the pack size is unknown. */
export function unitPriceLabel(r: Pick<SearchResult, "unitPricePaise" | "unit">): string | null {
  if (r.unitPricePaise == null || !r.unit) return null;
  return `${formatInr(r.unitPricePaise)} / ${r.unit}`;
}

export function whereLabel(r: Pick<SearchResult, "aisle" | "shelf">): string {
  if (!r.aisle) return "Location not mapped";
  return r.shelf ? `Aisle ${r.aisle} · Shelf ${r.shelf}` : `Aisle ${r.aisle}`;
}
