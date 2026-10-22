/**
 * The store-team side of the demo backends: staff accounts and their approval, staff sign-in,
 * reservations, tasks and stock corrections. A copy of the API's rules (staff_service.py and
 * store_ops.py) small enough to run in the browser, shared by the app demo and the dashboard demo.
 *
 * The host (the app demo or the dashboard demo) owns stock, carts and floor help; this class asks it
 * through `TeamHost` and emits the same events as the API.
 */
import type {
  CartSnapshot,
  MeResponse,
  PickupSlot,
  Reservation,
  ReservationItem,
  SmartCartEvent,
  StaffAccount,
  StaffLoginResponse,
  StaffRequest,
  StaffRole,
  StaffTask,
  StockCorrection,
  StockLevel,
} from "@smart-cart/contracts";
import { catalog } from "./catalog.js";
import { DemoApiError } from "./errors.js";
import type { DemoProduct } from "./types.js";

/** Accounts every demo starts with. Shown on the demo sign-in screens so testers can try each side. */
export const DEMO_LOGINS = [
  { role: "floor_staff", login: "S01-0002", password: "floor-demo-1", name: "Rajesh Kumar", label: "Floor staff" },
  { role: "manager", login: "S01-0001", password: "manager-demo-1", name: "Anita Desai", label: "Store manager" },
  { role: "admin", login: "ADM-0001", password: "admin-demo-1", name: "SmartCart Admin", label: "SmartCart admin team" },
] as const satisfies readonly { role: StaffRole; login: string; password: string; name: string; label: string }[];

/** Carts parked at the pickup point for picked reservations. Simulated shoppers never take these. */
export const PICKUP_CARTS = ["C-0016", "C-0017", "C-0018", "C-0020"];

const SESSION_HOURS = 12;
const TEMP_PASSWORD_HOURS = 72;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const SLOT_MINUTES = 30;
const LEAD_MINUTES = 30;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 22;
/** India Standard Time has no daylight saving, so a fixed offset is exact. */
const IST_OFFSET_MS = 330 * 60_000;
const ACTIVE: Reservation["status"][] = ["reserved", "picked"];

type Account = StaffAccount & {
  userId: string;
  password: string;
  tempExpiresAt: number | null;
  failedLogins: number;
  lockedUntil: number;
  employeeRef: string | null;
};
type Hold = Reservation & { userId: string };
type Task = StaffTask & { storeId: string };

/** A shopper or a signed-in store-team member, as the host resolved the bearer token. */
export type Caller = { kind: "shopper"; id: string; name: string } | { kind: "staff"; account: StaffAccount; userId: string; name: string };

export type TeamHost = {
  storeId: string;
  available(productId: string): number;
  onHand(productId: string): number;
  reservedQty(productId: string): number;
  /** Adds to (or with a negative delta, releases from) the units held for carts and reservations. */
  hold(productId: string, delta: number): void;
  /** A floor count or a restock changed the units on the shelf. */
  setOnHand(productId: string, onHand: number): void;
  emit(event: SmartCartEvent): void;
  /** True when no shopper is using the cart. */
  cartFree(cartCode: string): boolean;
  /** Pairs the shopper with the parked cart and puts the reservation's items in it. */
  collect?(caller: { id: string; name: string }, reservation: Reservation): CartSnapshot;
};

const byId = new Map(catalog.map((p) => [p.productId, p]));
const byBarcode = new Map(catalog.map((p) => [p.barcode, p]));
const uuid = () => globalThis.crypto.randomUUID();
const iso = (ms: number) => new Date(ms).toISOString();
const TEMP_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const tempPassword = () => Array.from({ length: 10 }, () => TEMP_ALPHABET[Math.floor(Math.random() * TEMP_ALPHABET.length)]).join("");

/** +91XXXXXXXXXX, or null when it isn't an Indian mobile number. */
export function normalisePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export const maskPhone = (phone: string | null) => (phone ? `+91 ••••• ${phone.slice(-5)}` : null);

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "password_too_short";
  if (/^\d+$/.test(password)) return "password_only_digits";
  return null;
}

/** The next half-hour pickup windows in store hours (IST), starting at least 30 minutes out. */
export function pickupSlots(now: number, count = 12): PickupSlot[] {
  const slots: PickupSlot[] = [];
  const step = SLOT_MINUTES * 60_000;
  let start = Math.ceil((now + LEAD_MINUTES * 60_000) / step) * step;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hm = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  while (slots.length < count) {
    const local = new Date(start + IST_OFFSET_MS);
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    if (minutes < OPEN_HOUR * 60) {
      start += (OPEN_HOUR * 60 - minutes) * 60_000;
      continue;
    }
    if (minutes + SLOT_MINUTES > CLOSE_HOUR * 60) {
      start += (24 * 60 - minutes + OPEN_HOUR * 60) * 60_000;
      continue;
    }
    const end = new Date(start + step + IST_OFFSET_MS);
    slots.push({ start: iso(start), end: iso(start + step), label: `${day[local.getUTCDay()]} ${hm(local)}–${hm(end)}` });
    start += step;
  }
  return slots;
}

export class StoreTeam {
  private accounts: Account[] = [];
  private requests: (StaffRequest & { requestedById: string })[] = [];
  private reservations: Hold[] = [];
  private tasks: Task[] = [];
  private corrections: StockCorrection[] = [];
  private sessions = new Map<string, { accountId: string; expiresAt: number }>();
  private onAccount = new Set<(a: { account: StaffAccount; password: string }) => void>();
  /** Someone signed in as store team in this tab: the simulated floor assistant stays out of the way. */
  staffSignedIn = false;

  constructor(private host: TeamHost) {
    this.seed(Date.now());
  }

  // ---- sign-in -----------------------------------------------------------------------------------

  /** Resolves a token this class issued; null for anything else (a shopper's token). */
  staffFor(token: string | null): Caller | null {
    if (!token?.startsWith("demo-staff.")) return null;
    const session = this.sessions.get(token);
    const account = session && this.accounts.find((a) => a.id === session.accountId);
    if (!session || !account || session.expiresAt < Date.now() || account.status !== "active") {
      throw new DemoApiError(401, "unauthenticated");
    }
    return { kind: "staff", account: this.wireAccount(account), userId: account.userId, name: account.name ?? "Staff" };
  }

  login(login: string, password: string): StaffLoginResponse {
    const phone = normalisePhone(login);
    const a = this.accounts.find((x) => (phone ? x.phone === phone : x.staffCode?.toUpperCase() === login.trim().toUpperCase()));
    const now = Date.now();
    if (!a) throw new DemoApiError(401, "invalid_credentials");
    if (a.lockedUntil > now) {
      throw new DemoApiError(423, "account_locked", { retryAfterSeconds: Math.ceil((a.lockedUntil - now) / 1000) });
    }
    if (a.password !== password) {
      a.failedLogins += 1;
      if (a.failedLogins >= MAX_FAILED_LOGINS) {
        a.failedLogins = 0;
        a.lockedUntil = now + LOCK_MINUTES * 60_000;
      }
      throw new DemoApiError(401, "invalid_credentials");
    }
    if (a.status !== "active") throw new DemoApiError(403, "account_inactive");
    if (a.mustChangePassword && a.tempExpiresAt && a.tempExpiresAt < now) throw new DemoApiError(403, "temporary_password_expired");
    a.failedLogins = 0;
    a.lockedUntil = 0;
    const token = `demo-staff.${a.id}.${uuid()}`;
    const expiresAt = now + SESSION_HOURS * 3_600_000;
    this.sessions.set(token, { accountId: a.id, expiresAt });
    this.staffSignedIn = true;
    return { token, expiresAt: iso(expiresAt), mustChangePassword: a.mustChangePassword, staff: this.wireAccount(a) };
  }

  /** New accounts approved here, with their temporary password, so the other demo tab can sign them in. */
  onAccountCreated(listener: (a: { account: StaffAccount; password: string }) => void): () => void {
    this.onAccount.add(listener);
    return () => this.onAccount.delete(listener);
  }

  /** An account approved in the other demo tab. */
  adopt(account: StaffAccount, password: string) {
    const local = this.accounts.find((a) => a.id === account.id || a.phone === account.phone);
    if (local) {
      // A resend in the other tab: its temporary password wins until they set their own here.
      if (local.mustChangePassword && account.mustChangePassword && local.password !== password) {
        local.password = password;
        local.tempExpiresAt = Date.now() + TEMP_PASSWORD_HOURS * 3_600_000;
      }
      return;
    }
    this.accounts.push({
      ...account,
      userId: `staff:${account.staffCode}`,
      password,
      tempExpiresAt: Date.now() + TEMP_PASSWORD_HOURS * 3_600_000,
      failedLogins: 0,
      lockedUntil: 0,
      employeeRef: null,
    });
  }

  me(caller: Caller): MeResponse {
    if (caller.kind === "shopper") return { userId: caller.id, name: caller.name, side: "shopper", role: "shopper", staff: null };
    return { userId: caller.userId, name: caller.name, side: "store", role: caller.account.role, staff: caller.account };
  }

  /** Parked carts the simulated shoppers must leave alone. */
  parkedCarts(): string[] {
    return this.reservations.filter((r) => r.status === "picked" && r.cartCode).map((r) => r.cartCode!);
  }

  /**
   * Answers the store-team and reservation routes. Returns undefined for anything else, so the host
   * can answer its own routes (carts, help, exit checks).
   */
  handle(method: string, url: URL, body: unknown, caller: Caller | null): unknown {
    const p = url.pathname;
    const route = (m: string, re: RegExp) => (method === m ? re.exec(p) : null);
    const s = "[^/]+";
    let m: RegExpExecArray | null;
    const b = (body ?? {}) as Record<string, unknown>;
    this.expireDue();

    if (route("POST", /^\/v1\/auth\/staff\/login$/)) return this.login(String(b.login ?? ""), String(b.password ?? ""));
    if (route("POST", /^\/v1\/auth\/staff\/password$/)) {
      return this.changePassword(this.staffCaller(caller, true), String(b.currentPassword ?? ""), String(b.newPassword ?? ""));
    }
    if (route("GET", /^\/v1\/me$/)) {
      if (!caller) throw new DemoApiError(401, "unauthenticated");
      return this.me(caller);
    }

    // Shopper: reservations
    const res = `^/v1/stores/${s}/reservations`;
    if (route("GET", new RegExp(`${res}/slots$`))) return { slots: pickupSlots(Date.now()) };
    if (route("POST", new RegExp(`${res}$`))) {
      const shopper = this.shopperCaller(caller);
      return this.reserve(shopper, b.items as { productId: string; qty: number }[], String(b.slotStart ?? ""));
    }
    if (route("GET", new RegExp(`${res}/mine$`))) {
      const shopper = this.shopperCaller(caller);
      const mine = this.reservations.filter((r) => r.userId === shopper.id).at(-1);
      return { reservation: mine ? this.wire(mine) : null };
    }
    if ((m = route("DELETE", new RegExp(`${res}/(${s})$`)))) {
      const r = this.owned(m[1]!, this.shopperCaller(caller).id);
      this.close(r, "cancelled");
      return this.announce("reservation.updated", r);
    }
    if ((m = route("POST", new RegExp(`${res}/(${s})/collect$`)))) {
      const shopper = this.shopperCaller(caller);
      const r = this.owned(m[1]!, shopper.id);
      if (r.status !== "picked" || !r.cartCode) throw new DemoApiError(409, "reservation_not_ready");
      if (!this.host.collect) throw new DemoApiError(404, "not_available_in_demo");
      // The hold moves from the reservation to the cart: release it here, the cart takes it again.
      for (const i of r.items) this.host.hold(i.productId, -i.qty);
      r.status = "collected";
      r.closedAt = iso(Date.now());
      const cart = this.host.collect(shopper, this.wire(r));
      return { reservation: this.announce("reservation.updated", r), cart };
    }

    // Floor staff on the handheld
    const floor = `^/staff/v1/stores/${s}`;
    if (route("GET", new RegExp(`${floor}/reservations/picklist$`))) {
      this.floorCaller(caller);
      return { storeId: this.host.storeId, reservations: this.active().map((r) => this.wire(r)) };
    }
    if ((m = route("POST", new RegExp(`${floor}/reservations/(${s})/picked$`)))) {
      return this.picked(this.floorCaller(caller), m[1]!, String(b.cartCode ?? ""));
    }
    if (route("GET", new RegExp(`${floor}/tasks$`))) {
      const staff = this.floorCaller(caller);
      return { storeId: this.host.storeId, tasks: this.taskList(staff.account.id) };
    }
    if ((m = route("POST", new RegExp(`${floor}/tasks/(${s})/done$`)))) {
      this.finishTask(this.floorCaller(caller), m[1]!, typeof b.restocked === "number" ? b.restocked : null);
      return { ok: true };
    }
    if ((m = route("GET", new RegExp(`${floor}/stock/(${s})$`)))) {
      this.floorCaller(caller);
      return this.stockFor(decodeURIComponent(m[1]!));
    }
    if (route("POST", new RegExp(`${floor}/stock-corrections$`))) {
      return this.correct(this.floorCaller(caller), String(b.barcode ?? ""), Number(b.counted), String(b.reason ?? ""));
    }

    // Managers on the dashboard
    const admin = `^/admin/v1/stores/${s}`;
    if (route("GET", new RegExp(`${admin}/reservations$`))) {
      this.managerCaller(caller);
      const dayAgo = Date.now() - 86_400_000;
      const rows = this.reservations
        .filter((r) => ACTIVE.includes(r.status) || Date.parse(r.slotStart) >= dayAgo)
        .sort((a, c) => a.slotStart.localeCompare(c.slotStart));
      return { storeId: this.host.storeId, reservations: rows.map((r) => this.wire(r)) };
    }
    if (route("GET", new RegExp(`${admin}/tasks$`))) {
      this.managerCaller(caller);
      return { storeId: this.host.storeId, tasks: this.taskList(null) };
    }
    if (route("POST", new RegExp(`${admin}/tasks$`))) {
      return { id: this.createTask(this.managerCaller(caller), b) };
    }
    if ((m = route("POST", new RegExp(`${admin}/tasks/(${s})/assign$`)))) {
      this.managerCaller(caller);
      const task = this.task(m[1]!);
      const to = (b.assignedTo as string | null) ?? null;
      const who = to ? this.accounts.find((a) => a.id === to && a.status === "active") : null;
      if (to && !who) throw new DemoApiError(404, "staff_not_found");
      task.assignedTo = who?.id ?? null;
      task.assignedName = who?.name ?? null;
      this.taskEvent(task.id);
      return { ok: true };
    }
    if (route("GET", new RegExp(`${admin}/staff$`))) {
      this.managerCaller(caller);
      const order = { active: 0, suspended: 1, deactivated: 2 };
      const staff = this.accounts
        .filter((a) => a.role !== "admin")
        .sort((a, c) => order[a.status] - order[c.status] || (a.name ?? "").localeCompare(c.name ?? ""));
      return { storeId: this.host.storeId, staff: staff.map((a) => this.wireAccount(a)) };
    }
    if ((m = route("POST", new RegExp(`${admin}/staff/(${s})/resend-password$`)))) {
      this.managerCaller(caller);
      const a = this.accounts.find((x) => x.id === m![1] && x.role !== "admin");
      if (!a) throw new DemoApiError(404, "staff_not_found");
      if (!a.mustChangePassword || a.status !== "active") throw new DemoApiError(409, "password_already_set");
      return { staff: this.wireAccount(a), ...this.sendTemp(a) };
    }
    if (route("GET", new RegExp(`${admin}/staff-requests$`))) {
      this.managerCaller(caller);
      return { storeId: this.host.storeId, requests: this.requests.slice().reverse().map((r) => this.wireRequest(r)) };
    }
    if (route("POST", new RegExp(`${admin}/staff-requests$`))) {
      return this.requestCreate(this.managerCaller(caller), b);
    }
    if ((m = route("PUT", new RegExp(`${admin}/staff-requests/(${s})$`)))) {
      return this.resubmit(this.managerCaller(caller), m[1]!, b);
    }
    if (route("POST", new RegExp(`${admin}/staff-requests/deactivate$`))) {
      return this.requestDeactivate(this.managerCaller(caller), String(b.staffId ?? ""), String(b.reason ?? ""));
    }
    if (route("GET", new RegExp(`${admin}/reports/stock-corrections$`))) {
      this.managerCaller(caller);
      const days = Number(url.searchParams.get("days") ?? 7);
      const since = Date.now() - days * 86_400_000;
      const rows = this.corrections.filter((c) => Date.parse(c.at!) >= since).sort((a, c) => c.at!.localeCompare(a.at!));
      return { storeId: this.host.storeId, days, corrections: rows };
    }

    // The SmartCart admin team
    if (route("GET", /^\/admin\/v1\/staff-requests$/)) {
      this.adminCaller(caller);
      const status = url.searchParams.get("status");
      const rows = this.requests.filter((r) => !status || r.status === status).reverse();
      return { requests: rows.map((r) => this.wireRequest(r)) };
    }
    if ((m = route("POST", new RegExp(`^/admin/v1/staff-requests/(${s})/review$`)))) {
      return this.review(this.adminCaller(caller), m[1]!, String(b.action ?? ""), (b.note as string | null) ?? null);
    }
    return undefined;
  }

  // ---- accounts ----------------------------------------------------------------------------------

  private changePassword(caller: Caller & { kind: "staff" }, current: string, next: string) {
    const a = this.accounts.find((x) => x.id === caller.account.id)!;
    if (a.password !== current) throw new DemoApiError(400, "wrong_password");
    const problem = passwordProblem(next);
    if (problem) throw new DemoApiError(400, problem);
    if (next === current) throw new DemoApiError(400, "password_unchanged");
    a.password = next;
    a.mustChangePassword = false;
    a.tempExpiresAt = null;
    return { ok: true, staff: this.wireAccount(a) };
  }

  private requestCreate(caller: Caller & { kind: "staff" }, b: Record<string, unknown>) {
    const phone = normalisePhone(String(b.phone ?? ""));
    if (!phone) throw new DemoApiError(400, "invalid_phone");
    this.assertPhoneFree(phone);
    const r = {
      id: uuid(),
      type: "create" as const,
      storeId: this.host.storeId,
      fullName: String(b.fullName ?? "").trim(),
      phone,
      role: (b.role === "manager" ? "manager" : "floor_staff") as StaffRole,
      shift: String(b.shift ?? "").trim() || null,
      employeeRef: String(b.employeeRef ?? "").trim() || null,
      staffId: null,
      reason: null,
      status: "pending" as const,
      requestedBy: caller.name,
      requestedById: caller.userId,
      reviewedBy: null,
      reviewNote: null,
      createdAt: iso(Date.now()),
      decidedAt: null,
    };
    if (r.fullName.length < 2) throw new DemoApiError(422, "invalid_request");
    this.requests.push(r);
    return this.wireRequest(r);
  }

  private resubmit(caller: Caller & { kind: "staff" }, id: string, b: Record<string, unknown>) {
    const r = this.requests.find((x) => x.id === id && x.type === "create");
    if (!r) throw new DemoApiError(404, "staff_request_not_found");
    if (r.status !== "changes_requested") throw new DemoApiError(409, "staff_request_not_editable");
    const phone = normalisePhone(String(b.phone ?? ""));
    if (!phone) throw new DemoApiError(400, "invalid_phone");
    this.assertPhoneFree(phone, r.id);
    Object.assign(r, {
      fullName: String(b.fullName ?? "").trim(),
      phone,
      role: b.role === "manager" ? "manager" : "floor_staff",
      shift: String(b.shift ?? "").trim() || null,
      employeeRef: String(b.employeeRef ?? "").trim() || null,
      status: "pending",
      requestedBy: caller.name,
    });
    return this.wireRequest(r);
  }

  private requestDeactivate(caller: Caller & { kind: "staff" }, staffId: string, reason: string) {
    const a = this.accounts.find((x) => x.id === staffId && x.role !== "admin");
    if (!a) throw new DemoApiError(404, "staff_not_found");
    if (a.userId === caller.userId) throw new DemoApiError(400, "cannot_deactivate_self");
    if (a.status !== "active") throw new DemoApiError(409, "staff_not_active");
    if (reason.trim().length < 2) throw new DemoApiError(422, "invalid_request");
    // Suspended at once, so a leaver cannot keep using the system while the request waits.
    a.status = "suspended";
    this.endSessions(a.id);
    const r = {
      id: uuid(),
      type: "deactivate" as const,
      storeId: this.host.storeId,
      fullName: a.name ?? "",
      phone: a.phone ?? "",
      role: a.role,
      shift: a.shift,
      employeeRef: a.employeeRef,
      staffId: a.id,
      reason: reason.trim(),
      status: "pending" as const,
      requestedBy: caller.name,
      requestedById: caller.userId,
      reviewedBy: null,
      reviewNote: null,
      createdAt: iso(Date.now()),
      decidedAt: null,
    };
    this.requests.push(r);
    return this.wireRequest(r);
  }

  private review(caller: Caller & { kind: "staff" }, id: string, action: string, rawNote: string | null) {
    const r = this.requests.find((x) => x.id === id);
    if (!r) throw new DemoApiError(404, "staff_request_not_found");
    if (r.status !== "pending") throw new DemoApiError(409, "staff_request_decided");
    if (r.requestedById === caller.userId) throw new DemoApiError(403, "cannot_review_own_request");
    const note = rawNote?.trim() || null;
    if ((action === "reject" || action === "request_changes") && !note) throw new DemoApiError(400, "reason_required");
    let result: Record<string, unknown> = {};
    if (action === "approve") {
      if (r.type === "create") {
        this.assertPhoneFree(r.phone, r.id);
        const prefix = this.host.storeId.replace("-", "").slice(0, 4).toUpperCase();
        const n = Math.max(0, ...this.accounts.map((a) => (a.staffCode?.startsWith(`${prefix}-`) ? Number(a.staffCode.split("-")[1]) : 0))) + 1;
        const code = `${prefix}-${String(n).padStart(4, "0")}`;
        const a: Account = {
          id: uuid(),
          staffCode: code,
          name: r.fullName,
          phone: r.phone,
          role: r.role,
          storeId: r.storeId,
          shift: r.shift,
          status: "active",
          mustChangePassword: true,
          createdAt: iso(Date.now()),
          userId: `staff:${code}`,
          password: "",
          tempExpiresAt: null,
          failedLogins: 0,
          lockedUntil: 0,
          employeeRef: r.employeeRef,
        };
        this.accounts.push(a);
        r.staffId = a.id;
        result = { staff: this.wireAccount(a), ...this.sendTemp(a) };
      } else {
        const a = this.accounts.find((x) => x.id === r.staffId);
        if (a) {
          a.status = "deactivated";
          a.phone = null; // frees the number for a future account
          this.endSessions(a.id);
          result = { staff: this.wireAccount(a) };
        }
      }
      r.status = "approved";
    } else if (action === "reject" || action === "request_changes") {
      if (action === "request_changes" && r.type !== "create") throw new DemoApiError(400, "cannot_request_changes");
      r.status = action === "reject" ? "rejected" : "changes_requested";
      if (r.type === "deactivate" && action === "reject") {
        const a = this.accounts.find((x) => x.id === r.staffId);
        if (a?.status === "suspended") a.status = "active";
      }
    } else {
      throw new DemoApiError(422, "invalid_request");
    }
    Object.assign(r, { reviewedBy: caller.name, reviewNote: note, decidedAt: iso(Date.now()) });
    return { request: this.wireRequest(r), ...result };
  }

  private sendTemp(a: Account) {
    const password = tempPassword();
    a.password = password;
    a.mustChangePassword = true;
    a.tempExpiresAt = Date.now() + TEMP_PASSWORD_HOURS * 3_600_000;
    a.failedLogins = 0;
    a.lockedUntil = 0;
    this.onAccount.forEach((l) => l({ account: this.wireAccount(a), password }));
    const devMessage =
      `SmartCart: your store-team login is ${a.staffCode}. Temporary password ${password}, ` +
      `valid ${TEMP_PASSWORD_HOURS} hours. You will set your own at first sign-in.`;
    return { sms: { to: maskPhone(a.phone)!, provider: "demo", devMessage } };
  }

  private assertPhoneFree(phone: string, ignoreRequest?: string) {
    const taken =
      this.accounts.some((a) => a.phone === phone && a.status !== "deactivated") ||
      this.requests.some((r) => r.id !== ignoreRequest && r.type === "create" && r.phone === phone && (r.status === "pending" || r.status === "changes_requested"));
    if (taken) throw new DemoApiError(409, "phone_already_registered");
  }

  private endSessions(accountId: string) {
    for (const [token, s] of this.sessions) if (s.accountId === accountId) this.sessions.delete(token);
  }

  // ---- reservations ------------------------------------------------------------------------------

  private reserve(shopper: { id: string; name: string }, rawItems: { productId: string; qty: number }[], slotStart: string) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) throw new DemoApiError(422, "invalid_request");
    const slot = pickupSlots(Date.now(), 64).find((x) => Date.parse(x.start) === Date.parse(slotStart));
    if (!slot) throw new DemoApiError(400, "invalid_slot");
    if (this.reservations.some((r) => r.userId === shopper.id && ACTIVE.includes(r.status))) {
      throw new DemoApiError(409, "reservation_exists");
    }
    const qty = new Map<string, number>();
    for (const i of rawItems) qty.set(i.productId, (qty.get(i.productId) ?? 0) + Math.max(1, Math.min(20, Math.floor(i.qty))));
    for (const [productId, n] of qty) {
      if (!byId.has(productId)) throw new DemoApiError(404, "product_not_found");
      const available = this.host.available(productId);
      if (n > available) throw new DemoApiError(409, "not_enough_stock", { productId, available: Math.max(0, available) });
    }
    const r = this.newReservation(shopper, [...qty], slot.start, slot.end, Date.now());
    return this.announce("reservation.created", r);
  }

  private newReservation(shopper: { id: string; name: string }, items: [string, number][], start: string, end: string, at: number, id: string = uuid()): Hold {
    const r: Hold = {
      id,
      storeId: this.host.storeId,
      status: "reserved",
      slotStart: start,
      slotEnd: end,
      cartCode: null,
      shopperName: shopper.name,
      pickedBy: null,
      items: items.map(([productId, qty]) => this.item(byId.get(productId)!, qty)),
      itemCount: 0,
      totalPaise: 0,
      createdAt: iso(at),
      pickedAt: null,
      closedAt: null,
      userId: shopper.id,
    };
    for (const [productId, qty] of items) this.host.hold(productId, qty);
    this.reservations.push(r);
    this.tasks.push(this.newTask("pick", `Pick reservation for ${shopper.name}`, r.id, at, Date.parse(start)));
    return r;
  }

  private picked(staff: Caller & { kind: "staff" }, id: string, rawCart: string) {
    const r = this.reservations.find((x) => x.id === id);
    if (!r) throw new DemoApiError(404, "reservation_not_found");
    if (r.status !== "reserved") throw new DemoApiError(409, "reservation_not_open");
    const code = rawCart.trim().toUpperCase();
    if (!/^C-\d{4}$/.test(code)) throw new DemoApiError(404, "cart_not_found");
    if (!this.host.cartFree(code) || this.parkedCarts().includes(code)) throw new DemoApiError(409, "cart_in_use");
    this.markPicked(r, code, staff.name, staff.userId);
    return this.announce("reservation.updated", r);
  }

  private markPicked(r: Hold, code: string, by: string, byUser: string) {
    Object.assign(r, { status: "picked", cartCode: code, pickedBy: by, pickedAt: iso(Date.now()) });
    r.items = r.items.map((i) => ({ ...i, pickedQty: i.qty }));
    this.finishTasksFor(r.id, by);
    void byUser;
  }

  /**
   * Without anyone signed in as store team in this tab, a simulated floor assistant picks a new
   * reservation after a short wait, so a shopper trying the demo alone sees it become ready.
   */
  simulatePick(id: string, afterMs = 20_000) {
    setTimeout(() => {
      const r = this.reservations.find((x) => x.id === id);
      if (!r || r.status !== "reserved" || this.staffSignedIn) return;
      const cart = PICKUP_CARTS.find((c) => this.host.cartFree(c) && !this.parkedCarts().includes(c));
      if (!cart) return;
      this.markPicked(r, cart, DEMO_LOGINS[0].name, "staff:S01-0002");
      this.announce("reservation.updated", r);
    }, afterMs);
  }

  /**
   * A reservation made or changed in the other demo tab (the shopper app), so the dashboard's board,
   * stock holds and pick tasks follow it. Emits the event locally; the other tab already broadcast it.
   */
  mirror(incoming: Reservation) {
    let r = this.reservations.find((x) => x.id === incoming.id);
    if (!r) {
      if (!ACTIVE.includes(incoming.status)) return;
      const shopper = { id: `app:${incoming.id}`, name: incoming.shopperName ?? "App shopper" };
      const items = incoming.items.filter((i) => byId.has(i.productId)).map((i): [string, number] => [i.productId, i.qty]);
      r = this.newReservation(shopper, items, incoming.slotStart, incoming.slotEnd, Date.parse(incoming.createdAt ?? "") || Date.now(), incoming.id);
      if (incoming.status === "reserved") return void this.announce("reservation.created", r);
    }
    if (incoming.status === r.status) return;
    if (incoming.status === "picked") {
      this.markPicked(r, incoming.cartCode ?? "", incoming.pickedBy ?? "Floor staff", "");
    } else if (incoming.status === "cancelled" || incoming.status === "expired") {
      this.close(r, incoming.status);
    } else if (incoming.status === "collected") {
      for (const i of r.items) this.host.hold(i.productId, -i.qty);
      Object.assign(r, { status: "collected", closedAt: incoming.closedAt ?? iso(Date.now()) });
    }
    this.announce("reservation.updated", r);
  }

  private close(r: Hold, status: "cancelled" | "expired") {
    for (const i of r.items) this.host.hold(i.productId, -i.qty);
    const wasPicked = r.status === "picked";
    r.status = status;
    r.closedAt = iso(Date.now());
    for (const t of this.tasks) if (t.refId === r.id && t.status === "open") t.status = "cancelled";
    if (wasPicked) {
      this.tasks.push(this.newTask("other", `Put back items from cart ${r.cartCode}`, r.id, Date.now(), null, `${r.shopperName ?? "Shopper"}'s reservation was ${status}.`));
    }
  }

  private expireDue() {
    const now = Date.now();
    for (const r of this.reservations) {
      if (ACTIVE.includes(r.status) && Date.parse(r.slotEnd) + 3_600_000 < now) {
        this.close(r, "expired");
        this.announce("reservation.updated", r);
      }
    }
  }

  private owned(id: string, userId: string) {
    const r = this.reservations.find((x) => x.id === id && x.userId === userId);
    if (!r) throw new DemoApiError(404, "reservation_not_found");
    if (!ACTIVE.includes(r.status)) throw new DemoApiError(409, "reservation_closed");
    return r;
  }

  private active() {
    return this.reservations.filter((r) => ACTIVE.includes(r.status)).sort((a, b) => a.slotStart.localeCompare(b.slotStart));
  }

  private announce(type: "reservation.created" | "reservation.updated", r: Hold): Reservation {
    const data = this.wire(r);
    this.host.emit({ ...this.envelope(r.cartCode), type, data });
    this.taskEvent(null);
    return data;
  }

  /** A reservation as the API sends it: items in walking order, with totals. */
  wire(r: Reservation): Reservation {
    const items = [...r.items].sort((a, b) => (a.aisle ?? "~").localeCompare(b.aisle ?? "~") || (a.shelf ?? "").localeCompare(b.shelf ?? ""));
    const { userId: _u, ...rest } = r as Hold;
    return {
      ...rest,
      items,
      itemCount: items.reduce((n, i) => n + i.qty, 0),
      totalPaise: items.reduce((n, i) => n + (i.pricePaise ?? 0) * i.qty, 0),
    };
  }

  private item(p: DemoProduct, qty: number): ReservationItem {
    return { productId: p.productId, name: p.name, qty, pickedQty: 0, aisle: p.aisle, shelf: p.shelf, pricePaise: p.pricePaise };
  }

  // ---- tasks -------------------------------------------------------------------------------------

  private newTask(type: StaffTask["type"], title: string, refId: string | null, at: number, dueAt: number | null = null, note: string | null = null): Task {
    return {
      id: uuid(),
      storeId: this.host.storeId,
      type,
      title,
      note,
      refId,
      status: "open",
      assignedTo: null,
      assignedName: null,
      dueAt: dueAt ? iso(dueAt) : null,
      createdAt: iso(at),
      doneAt: null,
      doneBy: null,
    };
  }

  /** One open restock task per product at or below its low-stock threshold. */
  private raiseRestockTasks() {
    let made = 0;
    for (const p of catalog) {
      if (this.host.available(p.productId) > p.lowStockThreshold) continue;
      if (this.tasks.some((t) => t.type === "restock" && t.refId === p.productId && t.status === "open")) continue;
      this.tasks.push(this.newTask("restock", `Restock ${p.name}`, p.productId, Date.now(), null, `Aisle ${p.aisle ?? "?"}, shelf ${p.shelf ?? "?"}`));
      made++;
    }
    if (made) this.taskEvent(null);
  }

  private taskList(staffId: string | null): StaffTask[] {
    this.raiseRestockTasks();
    const dayAgo = Date.now() - 86_400_000;
    const order = { open: 0, done: 1, cancelled: 2 };
    return this.tasks
      .filter((t) =>
        staffId
          ? t.status === "open" && (t.assignedTo === staffId || t.assignedTo === null)
          : t.status === "open" || (t.doneAt !== null && Date.parse(t.doneAt) >= dayAgo),
      )
      .sort((a, b) => order[a.status] - order[b.status] || (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~") || a.createdAt!.localeCompare(b.createdAt!))
      .map(({ storeId: _s, ...t }) => ({ ...t }));
  }

  private createTask(caller: Caller & { kind: "staff" }, b: Record<string, unknown>) {
    const type = b.type === "stock_check" || b.type === "other" ? b.type : "restock";
    const title = String(b.title ?? "").trim();
    if (title.length < 2) throw new DemoApiError(422, "invalid_request");
    const productId = (b.productId as string | null) ?? null;
    if (productId && !byId.has(productId)) throw new DemoApiError(404, "product_not_found");
    const to = (b.assignedTo as string | null) ?? null;
    const who = to ? this.accounts.find((a) => a.id === to && a.status === "active") : null;
    if (to && !who) throw new DemoApiError(404, "staff_not_found");
    const t = this.newTask(type, title, productId, Date.now(), null, String(b.note ?? "").trim() || null);
    t.assignedTo = who?.id ?? null;
    t.assignedName = who?.name ?? null;
    this.tasks.push(t);
    this.taskEvent(t.id);
    void caller;
    return t.id;
  }

  private task(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new DemoApiError(404, "task_not_found");
    return t;
  }

  private finishTask(staff: Caller & { kind: "staff" }, id: string, restocked: number | null) {
    const t = this.task(id);
    if (t.status !== "open") throw new DemoApiError(409, "task_closed");
    if (t.type === "pick") throw new DemoApiError(409, "use_pick_list");
    if (t.type === "restock" && restocked && restocked > 0 && t.refId && byId.has(t.refId)) {
      this.host.setOnHand(t.refId, this.host.onHand(t.refId) + Math.min(restocked, 10_000));
    }
    Object.assign(t, { status: "done", doneAt: iso(Date.now()), doneBy: staff.name });
    this.taskEvent(t.id);
  }

  private finishTasksFor(refId: string, by: string) {
    for (const t of this.tasks) {
      if (t.refId === refId && t.status === "open") Object.assign(t, { status: "done", doneAt: iso(Date.now()), doneBy: by });
    }
  }

  private taskEvent(taskId: string | null) {
    this.host.emit({ ...this.envelope(null), type: "task.updated", data: { taskId } });
  }

  // ---- stock -------------------------------------------------------------------------------------

  stockFor(barcode: string): StockLevel {
    const p = byBarcode.get(barcode.trim());
    if (!p) throw new DemoApiError(404, "product_not_found");
    const onHand = this.host.onHand(p.productId);
    const reserved = this.host.reservedQty(p.productId);
    return {
      productId: p.productId,
      barcode: p.barcode,
      name: p.name,
      onHand,
      reserved,
      available: onHand - reserved,
      lowStockThreshold: p.lowStockThreshold,
      aisle: p.aisle,
      shelf: p.shelf,
    };
  }

  private correct(staff: Caller & { kind: "staff" }, barcode: string, counted: number, reason: string) {
    const level = this.stockFor(barcode);
    if (!Number.isInteger(counted) || counted < 0 || counted > 100_000 || reason.trim().length < 2) {
      throw new DemoApiError(422, "invalid_request");
    }
    const delta = counted - level.onHand;
    if (delta !== 0) this.host.setOnHand(level.productId, counted);
    this.corrections.push({
      id: uuid(),
      productId: level.productId,
      name: level.name,
      systemQty: level.onHand,
      countedQty: counted,
      delta,
      reason: reason.trim(),
      staffName: staff.name,
      at: iso(Date.now()),
    });
    for (const t of this.tasks) {
      if (t.type === "stock_check" && t.refId === level.productId && t.status === "open") {
        Object.assign(t, { status: "done", doneAt: iso(Date.now()), doneBy: staff.name });
      }
    }
    this.taskEvent(null);
    return { ...this.stockFor(barcode), delta };
  }

  // ---- callers -----------------------------------------------------------------------------------

  private shopperCaller(caller: Caller | null) {
    if (!caller) throw new DemoApiError(401, "unauthenticated");
    if (caller.kind === "staff") return { id: caller.userId, name: caller.name };
    return caller;
  }

  private staffCaller(caller: Caller | null, allowPasswordChange = false): Caller & { kind: "staff" } {
    if (!caller) throw new DemoApiError(401, "unauthenticated");
    if (caller.kind !== "staff") throw new DemoApiError(403, "forbidden");
    const a = this.accounts.find((x) => x.id === caller.account.id);
    if (!allowPasswordChange && a?.mustChangePassword) throw new DemoApiError(403, "password_change_required");
    return caller;
  }

  private floorCaller(caller: Caller | null) {
    return this.staffCaller(caller);
  }

  private managerCaller(caller: Caller | null) {
    const c = this.staffCaller(caller);
    if (c.account.role === "floor_staff") throw new DemoApiError(403, "forbidden");
    return c;
  }

  private adminCaller(caller: Caller | null) {
    const c = this.staffCaller(caller);
    if (c.account.role !== "admin") throw new DemoApiError(403, "forbidden");
    return c;
  }

  // ---- wire --------------------------------------------------------------------------------------

  private wireAccount(a: Account): StaffAccount {
    return {
      id: a.id,
      staffCode: a.staffCode,
      name: a.name,
      phone: a.phone,
      role: a.role,
      storeId: a.storeId,
      shift: a.shift,
      status: a.status,
      mustChangePassword: a.mustChangePassword,
      createdAt: a.createdAt,
    };
  }

  private wireRequest(r: StaffRequest & { requestedById: string }): StaffRequest {
    const { requestedById: _r, ...wire } = r;
    return { ...wire };
  }

  private envelope(cartId: string | null) {
    return { eventId: uuid(), storeId: this.host.storeId, cartId, source: "system" as const, occurredAt: iso(Date.now()) };
  }

  // ---- sample data -------------------------------------------------------------------------------

  private seed(now: number) {
    const ago = (minutes: number) => iso(now - minutes * 60_000);
    const account = (
      code: string,
      name: string,
      phone: string,
      role: StaffRole,
      shift: string | null,
      password: string,
      createdMinutesAgo: number,
      extra: Partial<Account> = {},
    ): Account => ({
      id: `staff-${code}`,
      staffCode: code,
      name,
      phone,
      role,
      storeId: this.host.storeId,
      shift,
      status: "active",
      mustChangePassword: false,
      createdAt: ago(createdMinutesAgo),
      userId: `staff:${code}`,
      password,
      tempExpiresAt: null,
      failedLogins: 0,
      lockedUntil: 0,
      employeeRef: null,
      ...extra,
    });
    const [floor, manager, admin] = DEMO_LOGINS;
    this.accounts = [
      account(manager.login, manager.name, "+919820011223", "manager", "General", manager.password, 60 * 24 * 40),
      account(floor.login, floor.name, "+919820044556", "floor_staff", "Morning (7–3)", floor.password, 60 * 24 * 30),
      account("S01-0003", "Pooja Shinde", "+919820077889", "floor_staff", "Evening (2–10)", "pooja-demo-1", 60 * 24 * 9),
      account("S01-0004", "Imran Shaikh", "+919820033445", "floor_staff", "Evening (2–10)", tempPassword(), 60 * 26, {
        mustChangePassword: true,
        tempExpiresAt: now + 46 * 3_600_000,
      }),
      { ...account(admin.login, admin.name, "+919800000001", "admin", null, admin.password, 60 * 24 * 60), storeId: this.host.storeId },
    ];
    const mgr = this.accounts[0]!;
    const base = { storeId: this.host.storeId, staffId: null, reason: null, requestedBy: mgr.name, requestedById: mgr.userId };
    this.requests = [
      {
        ...base,
        id: uuid(),
        type: "create",
        fullName: "Pooja Shinde",
        phone: "+919820077889",
        role: "floor_staff",
        shift: "Evening (2–10)",
        employeeRef: "DM-2231",
        staffId: "staff-S01-0003",
        status: "approved",
        reviewedBy: admin.name,
        reviewNote: null,
        createdAt: ago(60 * 24 * 9 + 90),
        decidedAt: ago(60 * 24 * 9),
      },
      {
        ...base,
        id: uuid(),
        type: "create",
        fullName: "Imran Shaikh",
        phone: "+919820033445",
        role: "floor_staff",
        shift: "Evening (2–10)",
        employeeRef: "DM-2240",
        staffId: "staff-S01-0004",
        status: "approved",
        reviewedBy: admin.name,
        reviewNote: null,
        createdAt: ago(60 * 27),
        decidedAt: ago(60 * 26),
      },
      {
        ...base,
        id: uuid(),
        type: "create",
        fullName: "Karan Patil",
        phone: "+919820055667",
        role: "floor_staff",
        shift: null,
        employeeRef: null,
        status: "changes_requested",
        reviewedBy: admin.name,
        reviewNote: "Please add the shift and the DMart employee ID.",
        createdAt: ago(60 * 20),
        decidedAt: ago(60 * 18),
      },
      {
        ...base,
        id: uuid(),
        type: "create",
        fullName: "Sunita More",
        phone: "+919820099001",
        role: "floor_staff",
        shift: "Morning (7–3)",
        employeeRef: "DM-2252",
        status: "pending",
        reviewedBy: null,
        reviewNote: null,
        createdAt: ago(95),
        decidedAt: null,
      },
    ];

    // Reservations: one waiting to be picked, one parked at the pickup point, one collected earlier.
    const slots = pickupSlots(now, 4);
    const product = (name: string) => catalog.find((p) => p.name === name)!.productId;
    const waiting = this.newReservation(
      { id: "demo-shopper-neha", name: "Neha Kulkarni" },
      [
        [product("Aashirvaad Whole Wheat Atta 5 kg"), 1],
        [product("Tata Sampann Toor Dal 1 kg"), 2],
        [product("Amul Toned Milk 1 L"), 2],
      ],
      slots[0]!.start,
      slots[0]!.end,
      now - 40 * 60_000,
    );
    void waiting;
    const parked = this.newReservation(
      { id: "demo-shopper-sameer", name: "Sameer Khan" },
      [
        [product("Red Label Tea 250 g"), 1],
        [product("Parle-G Biscuits 250 g"), 3],
      ],
      slots[1]!.start,
      slots[1]!.end,
      now - 75 * 60_000,
    );
    this.markPicked(parked, "C-0018", floor.name, `staff:${floor.login}`);
    parked.pickedAt = ago(20);
    const done = this.newReservation(
      { id: "demo-shopper-lata", name: "Lata Iyer" },
      [[product("Amul Fresh Paneer 200 g"), 2]],
      ago(150),
      ago(120),
      now - 200 * 60_000,
    );
    this.markPicked(done, "C-0016", floor.name, `staff:${floor.login}`);
    for (const i of done.items) this.host.hold(i.productId, -i.qty);
    Object.assign(done, { status: "collected", pickedAt: ago(140), closedAt: ago(125) });

    // Tasks besides picks and the automatic restocks.
    const butter = catalog.find((p) => p.name === "Britannia Butter 100 g")!;
    const check = this.newTask("stock_check", `Count ${butter.name}`, butter.productId, now - 50 * 60_000, null, "Shelf looks short of what the system says.");
    Object.assign(check, { assignedTo: "staff-S01-0002", assignedName: floor.name });
    const spill = this.newTask("other", "Clean the spill near aisle B2", null, now - 130 * 60_000);
    Object.assign(spill, { status: "done", doneAt: ago(115), doneBy: "Pooja Shinde" });
    this.tasks.push(check, spill);

    const corr = (name: string, systemQty: number, countedQty: number, reason: string, staffName: string, minutesAgo: number): StockCorrection => ({
      id: uuid(),
      productId: product(name),
      name,
      systemQty,
      countedQty,
      delta: countedQty - systemQty,
      reason,
      staffName,
      at: ago(minutesAgo),
    });
    this.corrections = [
      corr("Amul Butter 100 g", 31, 29, "Two packs damaged", floor.name, 60 * 5),
      corr("Maggi Masala Noodles 70 g", 40, 37, "Count was short", "Pooja Shinde", 60 * 30),
      corr("Surf Excel Detergent Powder 1 kg", 18, 20, "Found a carton in the back room", floor.name, 60 * 52),
    ].filter((c) => c.productId);
  }
}
