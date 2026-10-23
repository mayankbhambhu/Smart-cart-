/**
 * Demo builds' copy of the API's anti-theft check and cart fleet (apps/api/src/smartcart/cart_guard.py):
 * simulated cart hardware (battery, aisle beacon, load cell), the weight-to-scan check, alerts for staff,
 * the exit gate and the bag check. Each demo tab weighs only its own carts; alerts are mirrored between
 * the tabs as security events, so an alert raised by the app demo shows on the dashboard and the other way.
 */
import type { CartFault, FleetCart, SecurityAlert, SmartCartEvent, WeightCheckStatus } from "@smart-cart/contracts";
import { catalog } from "./catalog.js";
import { DemoApiError } from "./errors.js";

export const TOLERANCE_G = 120;
export const TOLERANCE_PCT = 0.06;
export const LOW_BATTERY_PCT = 20;
const OFFLINE_AFTER_MS = 5 * 60_000;
/** The API waits 45 s before telling staff; the demo waits less so a tester sees it happen. */
export const DEMO_ALERT_AFTER_MS = 12_000;
export const FLEET = Array.from({ length: 20 }, (_, i) => `C-${String(i + 1).padStart(4, "0")}`);
const HW_FAULTS = new Set(["scale_error", "scanner_error", "beacon_lost", "lid_open"]);
const OPEN = new Set(["open", "acknowledged"]);

const weightOf = new Map(catalog.map((p) => [p.productId, p.weightG]));
const iso = (ms: number) => new Date(ms).toISOString();
const uuid = () => globalThis.crypto.randomUUID();

export type WeightCheck = { status: WeightCheckStatus; expectedG: number | null; diffG: number | null };

/** Same rule as the API: allow the larger of 120 g or 6% for scale drift; never guess without weights. */
export function weightCheck(measuredG: number, items: [weightG: number | null, qty: number][]): WeightCheck {
  if (items.some(([w]) => w === null)) return { status: "unknown", expectedG: null, diffG: null };
  const expectedG = items.reduce((n, [w, qty]) => n + w! * qty, 0);
  const diffG = measuredG - expectedG;
  const tolerance = Math.max(TOLERANCE_G, expectedG * TOLERANCE_PCT);
  const status = Math.abs(diffG) <= tolerance ? "ok" : diffG > 0 ? "extra" : "missing";
  return { status, expectedG, diffG };
}

/** What the guard needs to know about a cart's shopping session. */
export type GuardSession = {
  sessionId: string;
  cartCode: string;
  shopperName: string;
  startedAt: string;
  lines: Iterable<[productId: string, qty: number]>;
  lastAisle: string | null;
};

type Reading = {
  batteryPct: number;
  weightG: number;
  aisle: string | null;
  faults: string[];
  seenAt: number;
  mismatchSince: number | null;
  status: WeightCheckStatus | null;
  /** Grams in the basket that were never scanned: what the simulated load cell adds. */
  unscannedG: number;
};

export type GuardOptions = {
  storeId: string;
  emit: (e: SmartCartEvent) => void;
  sessionFor: (cartCode: string) => GuardSession | null;
  /** Carts whose weight this tab checks; the other tab's carts are mirrored, not weighed. */
  weighs: (cartCode: string) => boolean;
  alertAfterMs?: number;
};

export class Guard {
  private alerts: SecurityAlert[] = [];
  private readings = new Map<string, Reading>();
  private maintenance = new Map<string, string | null>();
  private changeListeners = new Set<() => void>();
  alertAfterMs: number;

  constructor(private opts: GuardOptions) {
    this.alertAfterMs = opts.alertAfterMs ?? DEMO_ALERT_AFTER_MS;
    // A fleet with some wear: batteries at different levels, one cart that hasn't checked in.
    const t = Date.now();
    FLEET.forEach((cart, i) => {
      const faults = cart === "C-0004" ? ["scanner_error"] : [];
      const seenAt = cart === "C-0020" ? t - 26 * 60_000 : t - (i % 5) * 4_000;
      this.readings.set(cart, {
        batteryPct: cart === "C-0017" ? 14 : 96 - ((i * 37) % 55),
        weightG: 0,
        aisle: null,
        faults,
        seenAt,
        mismatchSince: null,
        status: null,
        unscannedG: 0,
      });
    });
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  // ---- simulated hardware ----------------------------------------------------------------------

  /** The shopper puts something in the basket without scanning it (or takes it back out with 0). */
  setUnscanned(cartCode: string, grams: number) {
    const r = this.readings.get(cartCode);
    if (r) r.unscannedG = Math.max(0, grams);
  }

  unscannedG(cartCode: string) {
    return this.readings.get(cartCode)?.unscannedG ?? 0;
  }

  /** The cart sends a reading: battery, beacon aisle and what the load cell weighs now. */
  sense(cartCode: string, at = Date.now()) {
    const r = this.readings.get(cartCode);
    if (!r || cartCode === "C-0020") return; // C-0020 is offline in the demo
    const s = this.opts.sessionFor(cartCode);
    r.seenAt = at;
    if (s) {
      r.aisle = s.lastAisle ?? r.aisle;
      r.batteryPct = Math.max(5, r.batteryPct - (Math.random() < 0.15 ? 1 : 0));
    } else {
      r.aisle = null;
      r.unscannedG = 0;
    }
    if (!this.opts.weighs(cartCode)) return;
    const items = s ? [...s.lines].map(([id, qty]): [number | null, number] => [weightOf.get(id) ?? null, qty]) : [];
    const expected = items.every(([w]) => w !== null) ? items.reduce((n, [w, q]) => n + w! * q, 0) : 0;
    const noise = Math.round((Math.random() - 0.5) * 60);
    r.weightG = Math.max(0, expected + r.unscannedG + (expected || r.unscannedG ? noise : 0));
    if (!s) {
      r.status = null;
      r.mismatchSince = null;
      return;
    }
    this.check(cartCode, s, weightCheck(r.weightG, items), at);
  }

  private check(cartCode: string, s: GuardSession, check: WeightCheck, at: number) {
    const r = this.readings.get(cartCode)!;
    const was = r.status;
    r.status = check.status;
    const matches = check.status === "ok" || check.status === "unknown";
    if (matches) r.mismatchSince = null;
    else r.mismatchSince ??= at;
    // The shopper hears about a change, not every reading; a first reading that matches says nothing.
    if (was !== check.status && !(was === null && matches)) {
      this.emit("cart.weight_check", cartCode, "cart", { sessionId: s.sessionId, status: check.status, diffG: check.diffG });
    }
    const open = this.openAlert(s.sessionId, "unscanned_item");
    if (check.status === "extra" && !open && r.mismatchSince !== null && at - r.mismatchSince >= this.alertAfterMs) {
      this.raise({
        cartId: cartCode,
        session: s,
        kind: "unscanned_item",
        aisle: r.aisle,
        details: { expectedG: check.expectedG, measuredG: r.weightG, diffG: check.diffG },
      });
    } else if (check.status === "ok" && open) {
      this.close(open, "cleared", null, null);
    }
  }

  /** A cart passes the exit gate. Unpaid (still shopping or paying): the floor is told, once. */
  gatePass(cartCode: string, gateId: string): { result: "ok" | "alert"; alertId: string | null } {
    const s = this.opts.sessionFor(cartCode);
    if (!s) return { result: "ok", alertId: null };
    const existing = this.openAlert(s.sessionId, "exit_unpaid");
    if (existing) return { result: "alert", alertId: existing.id };
    const a = this.raise({
      cartId: cartCode,
      session: s,
      kind: "exit_unpaid",
      aisle: "EXIT",
      details: { gateId, sessionStatus: "active" },
    });
    return { result: "alert", alertId: a.id };
  }

  // ---- alerts ----------------------------------------------------------------------------------

  /** GET .../security-alerts: open ones, or the last day's. Newest first. */
  list(openOnly = true): SecurityAlert[] {
    const dayAgo = Date.now() - 86_400_000;
    return this.alerts
      .filter((a) => (openOnly ? OPEN.has(a.status) : Date.parse(a.createdAt) >= dayAgo))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100)
      .map((a) => ({ ...a }));
  }

  /** POST .../security-alerts/{id}: staff acknowledge, resolve or mark a false alarm. */
  act(id: string, action: string, note: string | null, staffName: string): SecurityAlert {
    const a = this.alerts.find((x) => x.id === id);
    if (!a) throw new DemoApiError(404, "alert_not_found");
    if (!OPEN.has(a.status)) throw new DemoApiError(409, "alert_closed");
    if (action === "acknowledge") {
      a.status = "acknowledged";
      a.handledBy = staffName;
      if (note) a.note = note;
      this.emit("security.updated", a.cartId, "staff", { ...a });
      return { ...a };
    }
    if (action !== "resolve" && action !== "false_alarm") throw new DemoApiError(400, "invalid_action");
    this.close(a, action === "resolve" ? "resolved" : "false_alarm", note, staffName);
    return { ...a };
  }

  /** On an exit check: an open unscanned-item alert for this session means staff check the bag. */
  bagCheck(sessionId: string): { alertId: string; reason: string } | null {
    const a = this.openAlert(sessionId, "unscanned_item");
    if (!a) return null;
    const grams = Math.max(50, Math.round(Number(a.details.diffG ?? 0) / 50) * 50);
    return {
      alertId: a.id,
      reason: `The cart weighed about ${grams} g more than the items scanned. Check the bag against the receipt.`,
    };
  }

  /** An alert raised or updated in the other demo tab. */
  mirror(alert: SecurityAlert) {
    const i = this.alerts.findIndex((a) => a.id === alert.id);
    if (i >= 0) this.alerts[i] = { ...alert };
    else this.alerts.push({ ...alert });
    if (!OPEN.has(alert.status)) this.sortedOut(alert);
    this.changed();
  }

  /** The other tab's weight check for one of its carts, for the fleet page. */
  mirrorCheck(cartCode: string, status: WeightCheckStatus) {
    const r = this.readings.get(cartCode);
    if (r) r.status = status;
  }

  /** Alerts from earlier in the day, so the Security page isn't empty when it opens. */
  seedHistory(rows: { cartId: string; shopperName: string; kind: SecurityAlert["kind"]; aisle: string; diffG?: number; minutesAgo: number; status: SecurityAlert["status"]; by?: string; note?: string }[]) {
    for (const r of rows) {
      const at = Date.now() - r.minutesAgo * 60_000;
      this.alerts.push({
        id: uuid(),
        storeId: this.opts.storeId,
        cartId: r.cartId,
        sessionId: null,
        shopperName: r.shopperName,
        kind: r.kind,
        aisle: r.aisle,
        details: r.kind === "unscanned_item" ? { expectedG: 2400, measuredG: 2400 + (r.diffG ?? 300), diffG: r.diffG ?? 300 } : { gateId: "G1", sessionStatus: "active" },
        status: r.status,
        note: r.note ?? null,
        handledBy: r.by ?? null,
        createdAt: iso(at),
        closedAt: OPEN.has(r.status) ? null : iso(at + 4 * 60_000),
      });
    }
  }

  // ---- fleet -----------------------------------------------------------------------------------

  /** GET .../fleet */
  fleet(): FleetCart[] {
    const now = Date.now();
    return FLEET.map((cart) => {
      const r = this.readings.get(cart)!;
      const s = this.opts.sessionFor(cart);
      const faults = r.faults.filter((f) => HW_FAULTS.has(f)) as CartFault[];
      if (r.batteryPct < LOW_BATTERY_PCT) faults.push("low_battery");
      if (now - r.seenAt > OFFLINE_AFTER_MS) faults.push("offline");
      return {
        cartId: cart,
        status: this.maintenance.has(cart) ? "maintenance" : s ? "in_use" : "available",
        sessionId: s?.sessionId ?? null,
        shopperName: s?.shopperName ?? null,
        startedAt: s?.startedAt ?? null,
        batteryPct: r.batteryPct,
        weightG: r.weightG,
        aisle: s ? r.aisle : null,
        seenAt: iso(r.seenAt),
        faults,
        weightCheck: s ? r.status : null,
        openAlerts: this.alerts.filter((a) => a.cartId === cart && OPEN.has(a.status)).length,
      } satisfies FleetCart;
    });
  }

  /** POST .../carts/{id}/status: take a free cart out of service, or put it back. */
  setStatus(cartCode: string, status: string, reason: string | null): FleetCart {
    if (!FLEET.includes(cartCode)) throw new DemoApiError(404, "cart_not_found");
    if (status !== "available" && status !== "maintenance") throw new DemoApiError(400, "invalid_status");
    if (this.opts.sessionFor(cartCode)) throw new DemoApiError(409, "cart_in_use");
    if (status === "maintenance") this.maintenance.set(cartCode, reason);
    else {
      this.maintenance.delete(cartCode);
      const r = this.readings.get(cartCode)!;
      r.faults = []; // fixed in the workshop
      if (r.batteryPct < LOW_BATTERY_PCT) r.batteryPct = 100;
    }
    this.changed();
    return this.fleet().find((c) => c.cartId === cartCode)!;
  }

  inMaintenance(cartCode: string) {
    return this.maintenance.has(cartCode);
  }

  maintenanceCarts(): string[] {
    return [...this.maintenance.keys()];
  }

  /** The other tab's maintenance list (the dashboard's is the store's). */
  setMaintenance(carts: string[]) {
    this.maintenance = new Map(carts.map((c) => [c, this.maintenance.get(c) ?? null]));
  }

  // ---- internals -------------------------------------------------------------------------------

  /** Simulation only: once staff have checked a cart, the unscanned item has been scanned or left behind. */
  private sortedOut(a: SecurityAlert) {
    const r = this.readings.get(a.cartId);
    if (r && a.kind === "unscanned_item" && a.status !== "cleared" && this.opts.weighs(a.cartId)) {
      r.unscannedG = 0;
      r.mismatchSince = null;
    }
  }

  private openAlert(sessionId: string, kind: SecurityAlert["kind"]) {
    return this.alerts.find((a) => a.sessionId === sessionId && a.kind === kind && OPEN.has(a.status)) ?? null;
  }

  private raise(a: { cartId: string; session: GuardSession; kind: SecurityAlert["kind"]; aisle: string | null; details: SecurityAlert["details"] }) {
    const alert: SecurityAlert = {
      id: uuid(),
      storeId: this.opts.storeId,
      cartId: a.cartId,
      sessionId: a.session.sessionId,
      shopperName: a.session.shopperName,
      kind: a.kind,
      aisle: a.aisle,
      details: a.details,
      status: "open",
      note: null,
      handledBy: null,
      createdAt: iso(Date.now()),
      closedAt: null,
    };
    this.alerts.push(alert);
    this.emit("security.alert", a.cartId, "cart", { ...alert });
    return alert;
  }

  private close(a: SecurityAlert, status: SecurityAlert["status"], note: string | null, by: string | null) {
    a.status = status;
    a.closedAt = iso(Date.now());
    if (note) a.note = note;
    if (by) a.handledBy = by;
    this.sortedOut(a);
    this.emit("security.updated", a.cartId, status === "cleared" ? "cart" : "staff", { ...a });
  }

  private emit<T extends "cart.weight_check" | "security.alert" | "security.updated">(
    type: T,
    cartId: string,
    source: "cart" | "staff",
    data: Extract<SmartCartEvent, { type: T }>["data"],
  ) {
    const e = { type, eventId: uuid(), storeId: this.opts.storeId, cartId, source, occurredAt: iso(Date.now()), data } as SmartCartEvent;
    this.opts.emit(e);
    if (type !== "cart.weight_check") this.changed();
  }

  private changed() {
    this.changeListeners.forEach((l) => l());
  }
}
