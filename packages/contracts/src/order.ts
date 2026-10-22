import { z } from "zod";
import { CartLine, CartTotals } from "./cart.js";
import { BasisPoints, CartCode, Paise, StoreId } from "./ids.js";

export const OrderStatus = z.enum(["pending_payment", "paid", "cancelled", "refunded"]);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** "fake" completes payments inside the API for development; "stripe" uses Stripe test or live mode. */
export const PaymentProviderName = z.enum(["fake", "stripe"]);
export type PaymentProviderName = z.infer<typeof PaymentProviderName>;

/** One row of the GST summary printed on the receipt, per rate. */
export const GstSummaryRow = z.object({
  gstRateBp: BasisPoints,
  /** Value before tax at this rate. */
  taxablePaise: Paise,
  taxPaise: Paise,
});

/** An order, which doubles as the e-receipt once paid. Prices are frozen at checkout. */
export const Receipt = z.object({
  orderId: z.string(),
  sessionId: z.string(),
  storeId: StoreId,
  storeName: z.string(),
  cartCode: CartCode,
  status: OrderStatus,
  lines: z.array(CartLine),
  totals: CartTotals,
  gstSummary: z.array(GstSummaryRow),
  /** Shown at the exit once paid; null until then. */
  exitCode: z.string().nullable(),
  /** Payload for the exit QR, e.g. smartcart://exit?order=…&code=…; null until paid. */
  exitQr: z.string().nullable(),
  exitUsedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Receipt = z.infer<typeof Receipt>;

/** What the app needs to collect payment for an order. */
export const PaymentIntent = z.object({
  provider: PaymentProviderName,
  /** The provider's id for this payment (a Stripe PaymentIntent id, or fake_…). */
  paymentId: z.string(),
  /** Stripe PaymentSheet client secret; null for the fake provider. */
  clientSecret: z.string().nullable(),
  /** Stripe publishable key the app initialises with; null for the fake provider. */
  publishableKey: z.string().nullable(),
});
export type PaymentIntent = z.infer<typeof PaymentIntent>;

export const CheckoutResponse = z.object({ order: Receipt, payment: PaymentIntent });
export type CheckoutResponse = z.infer<typeof CheckoutResponse>;

/** Staff at the exit check a shopper's code (typed or scanned from the exit QR). */
export const ExitCheckRequest = z.object({ code: z.string().min(4).max(200) });
export type ExitCheckRequest = z.infer<typeof ExitCheckRequest>;

export const ExitCheckResponse = z.object({
  /** "ok": paid and first use. "already_used": paid but shown before. "not_paid" / "not_found" otherwise. */
  result: z.enum(["ok", "already_used", "not_paid", "not_found"]),
  order: Receipt.nullable(),
});
export type ExitCheckResponse = z.infer<typeof ExitCheckResponse>;
