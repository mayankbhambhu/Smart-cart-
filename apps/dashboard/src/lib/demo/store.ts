/**
 * Demo mode: an in-browser stand-in for the API, so the dashboard can be hosted as static files
 * (GitHub Pages) and clicked through without a server. It answers the same GET requests and emits
 * the same SmartCartEvents as the real API, from simulated shoppers, so the pages run unchanged.
 */
import type { SmartCartEvent } from "@smart-cart/contracts";
import type { ActiveCart, InventoryItem, Totals } from "../api";
import catalog from "./catalog.json";

type Product = (typeof catalog)[number];
type Session = {
  sessionId: string;
  cartCode: string;
  shopperName: string;
  startedAt: string;
  lines: Map<string, number>;
};

const STORE = "S-01";
const SHOPPERS = [
  "Asha Patil", "Rohan Mehta", "Meera Iyer", "Kabir Shah", "Ananya Rao", "Vikram Nair",
  "Priya Desai", "Arjun Kulkarni", "Sneha Joshi", "Farhan Qureshi", "Divya Menon", "Rahul Gupta",
];
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
  private listeners = new Set<(e: SmartCartEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private pausedListeners = new Set<(paused: boolean) => void>();
  paused = false;

  constructor() {
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
          status: "active",
          startedAt: s.startedAt,
          totals: this.totals(s),
        }));
      return { storeId: STORE, sessions };
    }
    throw new Error(`GET ${path} is not available in demo mode`);
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
    const s = pick(sessions);
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

  /** The shopper pays and leaves: reserved units become sold units. */
  private checkout(s: Session) {
    this.sessions.delete(s.sessionId);
    for (const [productId, qty] of s.lines) {
      this.onHand.set(productId, this.onHand.get(productId)! - qty);
      this.reserved.set(productId, this.reserved.get(productId)! - qty);
      this.touch(productId);
      this.emit({
        ...this.envelope(null, "system"),
        type: "inventory.updated",
        data: { productId, onHand: this.onHand.get(productId)!, reserved: this.reserved.get(productId)! },
      });
    }
    this.emit({
      ...this.envelope(s.cartCode, "system"),
      type: "cart.session_ended",
      data: { sessionId: s.sessionId, reason: "paid" },
    });
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
