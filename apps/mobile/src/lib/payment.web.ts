import type { PaymentIntent } from "@smart-cart/contracts";
import { api } from "./api";
import type { PayResult } from "./payment";

/**
 * Web build (the demo page): Stripe's PaymentSheet is native-only, so only the test payment
 * provider works here. Real payments happen in the Android and iPhone apps.
 */
export async function collectPayment(orderId: string, payment: PaymentIntent): Promise<PayResult> {
  if (payment.provider !== "fake") return { kind: "failed", message: "Pay in the Smart Cart phone app." };
  await api.payFake(orderId);
  return { kind: "paid" };
}
