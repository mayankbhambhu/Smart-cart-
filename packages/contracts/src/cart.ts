import { z } from "zod";
import { BasisPoints, CartCode, Paise, StoreId } from "./ids.js";

export const CartLine = z.object({
  productId: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  imageUrl: z.string().nullable(),
  qty: z.number().int().positive(),
  unitPricePaise: Paise,
  gstRateBp: BasisPoints,
  lineTotalPaise: Paise,
  lineTaxPaise: Paise,
});
export type CartLine = z.infer<typeof CartLine>;

export const CartTotals = z.object({
  /** Sum of line totals, GST inclusive (Indian retail prices are tax inclusive). */
  totalPaise: Paise,
  /** GST portion contained in totalPaise. */
  taxPaise: Paise,
  /** totalPaise - taxPaise. */
  subtotalPaise: Paise,
  itemCount: z.number().int().nonnegative(),
});
export type CartTotals = z.infer<typeof CartTotals>;

export const CartSessionStatus = z.enum(["active", "checking_out", "paid", "abandoned"]);

export const CartSnapshot = z.object({
  sessionId: z.string(),
  cartCode: CartCode,
  storeId: StoreId,
  status: CartSessionStatus,
  lines: z.array(CartLine),
  totals: CartTotals,
  updatedAt: z.iso.datetime(),
});
export type CartSnapshot = z.infer<typeof CartSnapshot>;

export const PairCartRequest = z.object({
  cartCode: CartCode,
  storeId: StoreId,
});
export type PairCartRequest = z.infer<typeof PairCartRequest>;

export const AddItemRequest = z.object({
  barcode: z.string().regex(/^\d{8,14}$/),
  qty: z.number().int().min(1).max(50).default(1),
  /** Client-generated id so a retried request is applied once. */
  requestId: z.uuid(),
});
export type AddItemRequest = z.infer<typeof AddItemRequest>;
