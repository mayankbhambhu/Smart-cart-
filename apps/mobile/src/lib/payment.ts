import type { PaymentIntent } from "@smart-cart/contracts";
import { initPaymentSheet, initStripe, presentPaymentSheet } from "@stripe/stripe-react-native";
import { api } from "./api";

export type PayResult = { kind: "paid" } | { kind: "cancelled" } | { kind: "failed"; message: string };

/**
 * Collects payment for an order. With Stripe the shopper pays in Stripe's PaymentSheet (cards,
 * UPI where enabled); the API marks the order paid when Stripe's webhook arrives. With the API's
 * fake provider (development and demos) the API pays the order straight away.
 */
export async function collectPayment(orderId: string, payment: PaymentIntent): Promise<PayResult> {
  if (payment.provider === "fake") {
    await api.payFake(orderId);
    return { kind: "paid" };
  }
  if (!payment.clientSecret || !payment.publishableKey) return { kind: "failed", message: "Payment is not set up." };
  await initStripe({ publishableKey: payment.publishableKey, merchantIdentifier: "merchant.in.smartcart" });
  const init = await initPaymentSheet({
    merchantDisplayName: "Smart Cart",
    paymentIntentClientSecret: payment.clientSecret,
    returnURL: "smartcart://stripe-redirect",
  });
  if (init.error) return { kind: "failed", message: init.error.message };
  const result = await presentPaymentSheet();
  if (result.error) {
    return result.error.code === "Canceled" ? { kind: "cancelled" } : { kind: "failed", message: result.error.message };
  }
  return (await waitUntilPaid(orderId)) ? { kind: "paid" } : { kind: "failed", message: "Payment is still processing." };
}

/** Stripe confirms through a webhook to the API, usually within a second or two. */
async function waitUntilPaid(orderId: string, attempts = 15): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if ((await api.order(orderId)).status === "paid") return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
