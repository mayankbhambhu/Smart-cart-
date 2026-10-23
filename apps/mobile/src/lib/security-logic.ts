import type { SecurityAlert } from "@smart-cart/contracts";

/** What staff see for an alert: a cart to check, never an accusation. Scales drift; people bring bags. */
export function alertTitle(a: SecurityAlert): string {
  if (a.kind === "exit_unpaid") return `Cart ${a.cartId} at the exit without paying`;
  const g = Math.max(50, Math.round(Number(a.details.diffG ?? 0) / 50) * 50);
  return `Cart ${a.cartId}: about ${g} g more than its scans`;
}

export function alertAdvice(a: SecurityAlert): string {
  return a.kind === "exit_unpaid"
    ? "Greet them and help them pay in the app."
    : "They were asked to scan it. Offer help; if it's still there at the exit, check the bag with the receipt.";
}
