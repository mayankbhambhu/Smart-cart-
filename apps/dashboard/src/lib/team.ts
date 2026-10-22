import type { SmsReceipt, StaffRequestStatus, StaffRole } from "@smart-cart/contracts";
import type { Tone } from "@/components/ui";
import { ApiError } from "./api";

export const roleLabel: Record<StaffRole, string> = {
  floor_staff: "Floor staff",
  manager: "Store manager",
  admin: "SmartCart admin",
};

/** What a sign-in error means, in words for the person at the till. */
export function signInMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return "Something went wrong. Try again.";
  switch (e.code) {
    case "invalid_credentials":
      return "That staff ID or phone and password don't match. After 5 wrong tries the account locks for 15 minutes.";
    case "account_locked": {
      const minutes = Math.max(1, Math.ceil(Number(e.details.retryAfterSeconds ?? 900) / 60));
      return `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    case "account_inactive":
      return "This account is switched off. Ask the SmartCart admin team.";
    case "temporary_password_expired":
      return "The temporary password has expired. Ask for a new one to be sent.";
    case "network":
      return "Can't reach the SmartCart server.";
    default:
      return "Sign-in failed. Try again.";
  }
}

export function passwordMessage(e: unknown): string {
  const code = e instanceof ApiError ? e.code : "";
  return (
    {
      wrong_password: "The current password is wrong.",
      password_too_short: "Use at least 8 characters.",
      password_only_digits: "Use letters as well as numbers.",
      password_unchanged: "Choose a password different from the temporary one.",
    }[code] ?? "Could not change the password. Try again."
  );
}

/** Messages for creating and ending offers. */
export function offerMessage(e: unknown): string {
  const code = e instanceof ApiError ? e.code : "";
  return (
    {
      offer_price_not_lower: "The offer price must be below the product's regular price.",
      invalid_offer_window: "An offer runs for at most 31 days, and must end after it starts.",
      offer_exists: "This product already has an offer running. End that one first.",
      offer_ended: "That offer has already ended.",
      product_not_found: "Pick a product from the list.",
      forbidden: "Only store managers can run offers.",
    }[code] ?? "That didn't work. Try again."
  );
}

/** Messages for the account request flow. */
export function requestMessage(e: unknown): string {
  const code = e instanceof ApiError ? e.code : "";
  return (
    {
      invalid_phone: "That isn't an Indian mobile number.",
      phone_already_registered: "That number already has an account or a request waiting.",
      reason_required: "Give a reason so the manager knows what to fix.",
      cannot_review_own_request: "You raised this request, so someone else on the admin team must review it.",
      staff_request_decided: "Someone already decided this request.",
      cannot_deactivate_self: "You can't switch off your own account.",
      staff_not_active: "That account is already suspended or switched off.",
      password_already_set: "They've already set their own password.",
      forbidden: "Your account can't do that.",
    }[code] ?? "That didn't work. Try again."
  );
}

// Store times are India time wherever the dashboard is opened.
const IST = "Asia/Kolkata";
export const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit" }) : "—";
export const dateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { timeZone: IST, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";
export const phoneLabel = (p: string | null) => (p ? p.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2") : "—");

/** A pickup window such as "Fri 18:00–18:30", in India time. */
export function slotLabel(startIso: string, endIso: string): string {
  const f = (iso: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-IN", { timeZone: IST, ...o }).format(new Date(iso));
  const t = { hour: "2-digit", minute: "2-digit", hour12: false } as const;
  return `${f(startIso, { weekday: "short" })} ${f(startIso, t)}–${f(endIso, t)}`;
}

export const requestStatus: Record<StaffRequestStatus, { label: string; tone: Tone }> = {
  pending: { label: "Waiting for the admin team", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  changes_requested: { label: "Sent back for changes", tone: "blue" },
};

/** What was texted. Without an SMS provider the API returns the message so the demo can show it. */
export function smsText(lead: string, sms: SmsReceipt | undefined) {
  if (!sms) return `${lead}.`;
  return `${lead} by SMS to ${sms.to}.${sms.devMessage ? ` Test message (no SMS provider yet): “${sms.devMessage}”` : ""}`;
}
