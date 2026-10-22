/**
 * Demo mode: an in-browser stand-in for the API, so the dashboard can be hosted as static files
 * (GitHub Pages) and clicked through without a server. It answers the same GET requests and emits
 * the same SmartCartEvents as the real API, from simulated shoppers, so the pages run unchanged.
 */
import type { ExitCheckResponse, Receipt, SmartCartEvent } from "@smart-cart/contracts";
import type { ActiveCart, InventoryItem, OrderRow, Totals } from "../api";
import catalog from "./catalog.json";

type Product = (typeof catalog)[number];
type Session = {
  sessionId: string;
  cartCode: string;
  shopperName: string;
  startedAt: string;
  status: "active" | "checking_out";
  lines: Map<string, number>;
};

type DemoOrder = OrderRow & { session: Session };

const STORE = "S-01";
const SHOPPERS = [
  "Asha Patil", "Rohan Mehta", "Meera Iyer", "Kabir Shah", "Ananya Rao", "Vikram Nair",
  "Priya Desai", "Arjun Kulkarni", "Sneha Joshi", "Farhan Qureshi", "Divya Menon", "Rahul Gupta",
];
const EXIT_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const TICK_MS = 2500;
const MAX_CARTS = 8;

const byId = new Map<string, Product>(catalog.map((p) => [p.productId, p]));
const uuid = () => crypto.randomUUID();
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** GST contained in an inclusive price, rounded half up (same rule as the API). */
const gstIncluded = (total: number, rateBp: number) =>
  rateBp === 0 ? 0 : Math.floor((total * rateBp * 2 + (10_000 + rateBp)) / (2 * (10_000 + rateBp)));

class DemoStore {
  private onHand = new Map(catalog.map((p) => [p.productId, p.onHand]));
  private reserved = new Map(catalog.map((p) => [p.productId, 0]));
  private updatedAt = new Map(catalog.map((p) => [p.productId, new Date().toISOString()]));
  private sessions = new Map<string, Session>();
  private orders: DemoOrder[] = [];
  private listeners = new Set<(e: SmartCartEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private pausedListeners = new Set<(paused: boolean) => void>();
  paused = false;

  constructor() {
    // Earlier shoppers who already paid (most of them have left through the exit).
    for (let i = 0; i < 5; i++) {
      const s = this.pair(Date.now() - (60 - i * 9) * 60_000, false);
      if (!s) break;
      for (let n = 0; n < 3 + i; n++) this.add(s, false);
      const order = this.pay(s, false, Date.now() - (45 - i * 9) * 60_000);
      if (i < 4) order.exitUsedAt = new Date(Date.parse(order.createdAt) + 3 * 60_000).toISOString();
    }
    // A few shoppers already mid-shop when the page opens.
    for (let i = 0; i < 4; i++) {
      const s = this.pair(Date.now() - (3 + i * 6) * 60_000, false);
      if (!s) break;
      for (let n = 0; n < 2 + i; n++) this.add(s, false);
    }
  }

  // ---- REST stand-in -------------------------------------------------------------------------

  async get(path: string): Promise<unknown> {
    await new Promise((r) => setTimeout(r, 150)); // feel like a network call
    const url = new URL(path, "http://demo");
    if (url.pathname === `/admin/v1/stores/${STORE}/inventory`) {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const lowOnly = url.searchParams.get("lowStockOnly") === "true";
      const items = catalog
        .map((p) => this.item(p))
        .filter((i) => !q || i.name.toLowerCase().includes(q) || i.barcode?.includes(q))
        .filter((i) => !lowOnly || i.lowStock)
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      return { storeId: STORE, items };
    }
    if (url.pathname === `/admin/v1/stores/${STORE}/carts`) {
      const sessions: ActiveCart[] = [...this.sessions.values()]
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .map((s) => ({
          sessionId: s.sessionId,
          cartCode: s.cartCode,
          shopperName: s.shopperName,
          status: s.status,
          startedAt: s.startedAt,
          totals: this.totals(s),
        }));
      return { storeId: STORE, sessions };
    }
    if (url.pathname === `/admin/v1/stores/${STORE}/orders`) {
      const orders = [...this.orders]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ session: _session, ...row }) => row);
      return { storeId: STORE, orders };
    }
    throw new Error(`GET ${path} is not available in demo mode`);
  }

  async post(path: string, body: unknown): Promise<unknown> {
    await new Promise((r) => setTimeout(r, 150));
    if (path === `/admin/v1/stores/${STORE}/exit-checks`) {
      const raw = String((body as { code?: string }).code ?? "");
      const code = (raw.includes("code=") ? raw.split("code=")[1]! : raw).trim().toUpperCase();
      const order = this.orders.find((o) => o.exitCode === code);
      if (!order) return { result: "not_found", order: null } satisfies ExitCheckResponse;
      const result = order.exitUsedAt ? "already_used" : "ok";
      order.exitUsedAt ??= new Date().toISOString();
      return { result, order: this.receipt(order) } satisfies ExitCheckResponse;
    }
    throw new Error(`POST ${path} is not available in demo mode`);
  }

  // ---- live events ---------------------------------------------------------------------------

  subscribe(listener: (e: SmartCartEvent) => void): () => void {
    this.listeners.add(listener);
    if (!this.timer && !this.paused) this.timer = setInterval(() => this.tick(), TICK_MS);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  onPausedChange(listener: (paused: boolean) => void): () => void {
    this.pausedListeners.add(listener);
    return () => this.pausedListeners.delete(listener);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) this.stop();
    else if (this.listeners.size > 0 && !this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.pausedListeners.forEach((l) => l(paused));
  }

  /** A new shopper pairs a free cart and scans a first item. */
  addShopper() {
    const s = this.pair(Date.now(), true);
    if (s) this.add(s, true);
  }

  /** The code of a paid order nobody has shown at the exit yet, so testers can try the door check. */
  unusedExitCode(): string | null {
    return this.orders.find((o) => !o.exitUsedAt)?.exitCode ?? null;
  }

  /** A shopper takes enough of the item closest to its threshold to trigger a low-stock alert. */
  triggerLowStock() {
    const s = [...this.sessions.values()][0] ?? this.pair(Date.now(), true);
    if (!s) return;
    const headroom = (p: Product) => this.available(p.productId) - p.lowStockThreshold;
    const target = catalog.filter((p) => headroom(p) > 0).sort((a, b) => headroom(a) - headroom(b))[0];
    if (target) this.add(s, true, target, headroom(target));
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const sessions = [...this.sessions.values()];
    const r = Math.random();
    if (sessions.length === 0 || (sessions.length < MAX_CARTS && r < 0.2)) return this.addShopper();
    const paying = sessions.find((s) => s.status === "checking_out");
    if (paying && r < 0.6) return void this.pay(paying, true);
    const shopping = sessions.filter((s) => s.status === "active");
    if (shopping.length === 0) return this.addShopper();
    const s = pick(shopping);
    const items = [...s.lines.values()].reduce((a, b) => a + b, 0);
    if (r < 0.3 && items >= 4) return this.checkout(s);
    if (r < 0.38 && s.lines.size > 0) return this.removeOne(s);
    this.add(s, true);
  }

  private pair(startedAt: number, emit: boolean): Session | null {
    const used = new Set([...this.sessions.values()].map((s) => s.cartCode));
    const free = Array.from({ length: 20 }, (_, i) => `C-${String(i + 1).padStart(4, "0")}`).filter((c) => !used.has(c));
    const names = new Set([...this.sessions.values()].map((s) => s.shopperName));
    const shoppers = SHOPPERS.filter((n) => !names.has(n));
    if (free.length === 0 || shoppers.length === 0) return null;
    const s: Session = {
      sessionId: uuid(),
      cartCode: pick(free),
      shopperName: pick(shoppers),
      startedAt: new Date(startedAt).toISOString(),
      status: "active",
      lines: new Map(),
    };
    this.sessions.set(s.sessionId, s);
    if (emit)
      this.emit({
        ...this.envelope(s.cartCode, "phone"),
        type: "cart.session_started",
        data: { sessionId: s.sessionId, cartCode: s.cartCode, userId: `demo-${s.shopperName}` },
      });
    return s;
  }

  private add(s: Session, emit: boolean, product?: Product, qty = Math.random() < 0.8 ? 1 : 2) {
    const p = product ?? pick(catalog.filter((x) => this.available(x.productId) > 0));
    if (!p) return;
    qty = Math.min(qty, this.available(p.productId));
    if (qty <= 0) return;
    s.lines.set(p.productId, (s.lines.get(p.productId) ?? 0) + qty);
    const wasAvailable = this.available(p.productId);
    this.reserved.set(p.productId, this.reserved.get(p.productId)! + qty);
    this.touch(p.productId);
    if (!emit) return;
    this.emit({
      ...this.envelope(s.cartCode, "phone"),
      type: "cart.item_added",
      data: { sessionId: s.sessionId, line: this.line(p, s.lines.get(p.productId)!), totals: this.totals(s) },
    });
    this.stockChanged(p, s.cartCode, wasAvailable);
  }

  private removeOne(s: Session) {
    const productId = pick([...s.lines.keys()]);
    const p = byId.get(productId)!;
    const qty = s.lines.get(productId)! - 1;
    if (qty > 0) s.lines.set(productId, qty);
    else s.lines.delete(productId);
    const wasAvailable = this.available(productId);
    this.reserved.set(productId, this.reserved.get(productId)! - 1);
    this.touch(productId);
    this.emit({
      ...this.envelope(s.cartCode, "phone"),
      type: "cart.item_removed",
      data: { sessionId: s.sessionId, productId, line: qty > 0 ? this.line(p, qty) : null, totals: this.totals(s) },
    });
    this.stockChanged(p, s.cartCode, wasAvailable);
  }

  /** The shopper taps Checkout: the cart freezes while they pay. */
  private checkout(s: Session) {
    s.status = "checking_out";
    this.emit({
      ...this.envelope(s.cartCode, "phone"),
      type: "cart.checked_out",
      data: { sessionId: s.sessionId, orderId: uuid(), totals: this.totals(s) },
    });
  }

  /** Payment succeeds: reserved units become sold units, the cart is freed, an exit code issued. */
  private pay(s: Session, emit: boolean, at = Date.now()): DemoOrder {
    this.sessions.delete(s.sessionId);
    const totals = this.totals(s);
    const order: DemoOrder = {
      orderId: uuid(),
      cartCode: s.cartCode,
      shopperName: s.shopperName,
      status: "paid",
      totalPaise: totals.totalPaise,
      taxPaise: totals.taxPaise,
      itemCount: totals.itemCount,
      exitCode: Array.from({ length: 6 }, () => pick([...EXIT_ALPHABET])).join(""),
      exitUsedAt: null,
      createdAt: new Date(at).toISOString(),
      session: s,
    };
    this.orders.push(order);
    for (const [productId, qty] of s.lines) {
      this.onHand.set(productId, this.onHand.get(productId)! - qty);
      this.reserved.set(productId, this.reserved.get(productId)! - qty);
      this.touch(productId);
      if (emit)
        this.emit({
          ...this.envelope(null, "system"),
          type: "inventory.updated",
          data: { productId, onHand: this.onHand.get(productId)!, reserved: this.reserved.get(productId)! },
        });
    }
    if (emit) {
      this.emit({
        ...this.envelope(s.cartCode, "system"),
        type: "order.paid",
        data: { orderId: order.orderId, sessionId: s.sessionId, totalPaise: order.totalPaise },
      });
      this.emit({
        ...this.envelope(s.cartCode, "system"),
        type: "cart.session_ended",
        data: { sessionId: s.sessionId, reason: "paid" },
      });
    }
    return order;
  }

  private receipt(o: DemoOrder): Receipt {
    const lines = [...o.session.lines].map(([productId, qty]) => this.line(byId.get(productId)!, qty));
    const byRate = new Map<number, { taxablePaise: number; taxPaise: number }>();
    for (const l of lines) {
      const row = byRate.get(l.gstRateBp) ?? { taxablePaise: 0, taxPaise: 0 };
      row.taxablePaise += l.lineTotalPaise - l.lineTaxPaise;
      row.taxPaise += l.lineTaxPaise;
      byRate.set(l.gstRateBp, row);
    }
    return {
      orderId: o.orderId,
      sessionId: o.session.sessionId,
      storeId: STORE,
      storeName: "DMart Pilot Store (demo)",
      cartCode: o.cartCode,
      status: o.status,
      lines,
      totals: { totalPaise: o.totalPaise, taxPaise: o.taxPaise, subtotalPaise: o.totalPaise - o.taxPaise, itemCount: o.itemCount },
      gstSummary: [...byRate].map(([gstRateBp, r]) => ({ gstRateBp, ...r })),
      exitCode: o.exitCode,
      exitQr: `smartcart://exit?order=${o.orderId}&code=${o.exitCode}`,
      exitUsedAt: o.exitUsedAt,
      createdAt: o.createdAt,
    };
  }

  private stockChanged(p: Product, cartCode: string, wasAvailable: number) {
    const onHand = this.onHand.get(p.productId)!;
    const reserved = this.reserved.get(p.productId)!;
    this.emit({
      ...this.envelope(cartCode, "system"),
      type: "inventory.updated",
      data: { productId: p.productId, onHand, reserved },
    });
    const available = onHand - reserved;
    if (wasAvailable > p.lowStockThreshold && available <= p.lowStockThreshold)
      this.emit({
        ...this.envelope(cartCode, "system"),
        type: "inventory.low_stock",
        data: { productId: p.productId, name: p.name, onHand, available, threshold: p.lowStockThreshold },
      });
  }

  private available(productId: string) {
    return this.onHand.get(productId)! - this.reserved.get(productId)!;
  }

  private touch(productId: string) {
    this.updatedAt.set(productId, new Date().toISOString());
  }

  private item(p: Product): InventoryItem {
    const available = this.available(p.productId);
    return {
      productId: p.productId,
      name: p.name,
      brand: p.brand,
      category: p.category,
      barcode: p.barcode,
      pricePaise: p.pricePaise,
      onHand: this.onHand.get(p.productId)!,
      reserved: this.reserved.get(p.productId)!,
      available,
      lowStockThreshold: p.lowStockThreshold,
      lowStock: available <= p.lowStockThreshold,
      aisle: p.aisle,
      shelf: p.shelf,
      updatedAt: this.updatedAt.get(p.productId)!,
    };
  }

  private line(p: Product, qty: number) {
    const lineTotalPaise = p.pricePaise * qty;
    return {
      productId: p.productId,
      name: p.name,
      brand: p.brand,
      imageUrl: null,
      qty,
      unitPricePaise: p.pricePaise,
      gstRateBp: p.gstRateBp,
      lineTotalPaise,
      lineTaxPaise: gstIncluded(lineTotalPaise, p.gstRateBp),
    };
  }

  private totals(s: Session): Totals {
    let totalPaise = 0;
    let taxPaise = 0;
    let itemCount = 0;
    for (const [productId, qty] of s.lines) {
      const l = this.line(byId.get(productId)!, qty);
      totalPaise += l.lineTotalPaise;
      taxPaise += l.lineTaxPaise;
      itemCount += qty;
    }
    return { totalPaise, taxPaise, subtotalPaise: totalPaise - taxPaise, itemCount };
  }

  private envelope(cartId: string | null, source: "phone" | "system") {
    return { eventId: uuid(), storeId: STORE, cartId, source, occurredAt: new Date().toISOString() };
  }

  private emit(e: SmartCartEvent) {
    this.listeners.forEach((l) => l(e));
  }
}

let store: DemoStore | null = null;
/** One shared demo store per browser tab, created on first use. */
export const demoStore = () => (store ??= new DemoStore());
