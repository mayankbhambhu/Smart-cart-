import type { CartLine, CartSnapshot, CartTotals, SmartCartEvent } from "@smart-cart/contracts";

/** Replaces, adds or removes one line, taking the server's totals as they are. */
export function withLine(
  cart: CartSnapshot,
  productId: string,
  line: CartLine | null,
  totals: CartTotals,
): CartSnapshot {
  const lines = cart.lines.filter((l) => l.productId !== productId);
  if (line) lines.push(line);
  lines.sort((a, b) => a.name.localeCompare(b.name));
  return { ...cart, lines, totals };
}

export type CartEventOutcome =
  | { kind: "cart"; cart: CartSnapshot }
  | { kind: "ended"; reason: string }
  | { kind: "paid"; orderId: string }
  | { kind: "ignore" };

/** How a server event changes the shopper's cart. Pure, so it is easy to test. */
export function applyEvent(cart: CartSnapshot | null, event: SmartCartEvent): CartEventOutcome {
  switch (event.type) {
    case "cart.snapshot":
      return { kind: "cart", cart: event.data };
    case "cart.item_added":
      if (!cart || event.data.sessionId !== cart.sessionId) return { kind: "ignore" };
      return { kind: "cart", cart: withLine(cart, event.data.line.productId, event.data.line, event.data.totals) };
    case "cart.item_removed":
      if (!cart || event.data.sessionId !== cart.sessionId) return { kind: "ignore" };
      return { kind: "cart", cart: withLine(cart, event.data.productId, event.data.line, event.data.totals) };
    case "cart.checked_out":
      if (!cart || event.data.sessionId !== cart.sessionId) return { kind: "ignore" };
      return { kind: "cart", cart: { ...cart, status: "checking_out", totals: event.data.totals } };
    case "order.paid":
      if (!cart || event.data.sessionId !== cart.sessionId) return { kind: "ignore" };
      return { kind: "paid", orderId: event.data.orderId };
    case "cart.session_ended":
      if (!cart || event.data.sessionId !== cart.sessionId) return { kind: "ignore" };
      return { kind: "ended", reason: event.data.reason };
    default:
      return { kind: "ignore" };
  }
}
