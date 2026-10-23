import type { CartFault, SecurityAlert } from "@smart-cart/contracts";

/**
 * Wording for security alerts. An alert asks staff to check a cart; it never says a shopper stole
 * anything. Scales drift, and people put their own bags in the basket.
 */
export function alertTitle(a: SecurityAlert): string {
  if (a.kind === "exit_unpaid") return `Cart ${a.cartId} is at exit gate ${a.details.gateId ?? ""} without paying`.trim();
  const g = Number(a.details.diffG ?? 0);
  return `Cart ${a.cartId} weighs about ${Math.max(50, Math.round(g / 50) * 50)} g more than its scans`;
}

export function alertAdvice(a: SecurityAlert): string {
  if (a.kind === "exit_unpaid")
    return "Greet the shopper and help them pay in the app. They may have forgotten, or the payment may still be going through.";
  return "The shopper was asked in the app to scan it. Offer help nearby; if it's still there at the exit, check the bag against the receipt.";
}

export const statusLabel: Record<SecurityAlert["status"], string> = {
  open: "Needs a check",
  acknowledged: "Someone is on it",
  resolved: "Checked",
  false_alarm: "False alarm",
  cleared: "Cleared by the cart",
};

export const faultLabel: Record<CartFault, string> = {
  scale_error: "Scale error",
  scanner_error: "Scanner error",
  beacon_lost: "No aisle signal",
  lid_open: "Lid open",
  low_battery: "Low battery",
  offline: "Offline",
};

export function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return s < 10 ? "just now" : `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
