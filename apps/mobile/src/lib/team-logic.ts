import type { FoodType, Reservation, StaffRole, StaffTask } from "@smart-cart/contracts";
import { ApiError } from "./api";

/** What a staff sign-in error means to the person holding the handheld. */
export function staffLoginMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return "Something went wrong. Try again.";
  switch (e.code) {
    case "invalid_credentials":
      return "That staff ID or phone and password don't match. After 5 wrong tries the account locks for 15 minutes.";
    case "account_locked": {
      const minutes = Math.max(1, Math.ceil(Number(e.details.retryAfterSeconds ?? 900) / 60));
      return `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask your manager.`;
    }
    case "account_inactive":
      return "This account is switched off. Ask your store manager.";
    case "temporary_password_expired":
      return "Your temporary password has expired. Ask your manager to send a new one.";
    case "network":
      return "Can't reach the store server. Check the Wi-Fi and try again.";
    default:
      return "Sign-in failed. Try again.";
  }
}

export function passwordMessage(code: string): string {
  return (
    {
      wrong_password: "The current password is wrong.",
      password_too_short: "Use at least 8 characters.",
      password_only_digits: "Use letters as well as numbers.",
      password_unchanged: "Choose a password different from the temporary one.",
    }[code] ?? "Could not change the password. Try again."
  );
}

/** Same rule as the API: 8 or more characters, not only digits. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "password_too_short";
  if (/^\d+$/.test(password)) return "password_only_digits";
  return null;
}

export const roleLabel: Record<StaffRole, string> = {
  floor_staff: "Floor staff",
  manager: "Store manager",
  admin: "SmartCart admin",
};

/** The pack's FSSAI mark, as the app shows it. Never guessed: null is "Not labelled". */
export function foodLabel(type: FoodType | null | undefined): { text: string; dot: string | null } {
  switch (type) {
    case "veg":
      return { text: "Veg", dot: "#15803D" };
    case "non_veg":
      return { text: "Non-veg", dot: "#7C2D12" };
    case "egg":
      return { text: "Egg", dot: "#7C2D12" };
    case "not_food":
      return { text: "Not food", dot: null };
    default:
      return { text: "Not labelled", dot: null };
  }
}

export const reservationStatusLabel: Record<Reservation["status"], string> = {
  reserved: "Reserved, waiting to be picked",
  picked: "Ready for pickup",
  collected: "Collected",
  expired: "Expired",
  cancelled: "Cancelled",
};

/** A pickup window such as "Fri 18:00–18:30", from ISO times, in India time. */
export function slotLabel(startIso: string, endIso: string): string {
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...opts }).format(new Date(iso));
  const time = { hour: "2-digit", minute: "2-digit", hour12: false } as const;
  return `${fmt(startIso, { weekday: "short" })} ${fmt(startIso, time)}–${fmt(endIso, time)}`;
}

export const taskIcon: Record<StaffTask["type"], string> = { restock: "📦", pick: "🧺", stock_check: "🔢", other: "📋" };

/** Shopping basket for a reservation: product id to quantity, capped like the API (1 to 20). */
export function setQty(basket: Record<string, number>, productId: string, qty: number): Record<string, number> {
  const next = { ...basket };
  if (qty <= 0) delete next[productId];
  else next[productId] = Math.min(20, Math.floor(qty));
  return next;
}
