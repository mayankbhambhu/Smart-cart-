/**
 * The shopper app's demo backend: answers the app's REST calls and pushes its cart events in the
 * browser, so the real app can run as a clickable web page with no server (GitHub Pages, previews).
 *
 * When the store dashboard demo is open in the same browser (same site), the two talk over a
 * BroadcastChannel: the shopper's cart, payment, help requests and reservations show up on the
 * dashboard, and staff pressing "I'm on my way" there updates the app. Without a dashboard, a
 * simulated floor assistant answers help requests and picks reservations after a short wait.
 *
 * The same app also runs in store-team mode: sign in with a demo staff ID (see DEMO_LOGINS) to work
 * the help inbox, pick list, tasks, stock checks and exit checks against this simulated store.
 */
import type {
  AskResponse,
  CartLine,
  CartSnapshot,
  CartTotals,
  CheckoutResponse,
  HelpRequest,
  HelpTopic,
  OffersResponse,
  Receipt,
  RouteListResponse,
  Reservation,
  SearchResult,
  SmartCartEvent,
  StaffAccount,
} from "@smart-cart/contracts";
import { catalog } from "./catalog.js";
import { Deals, type DemoOffer } from "./deals.js";
import { DemoApiError } from "./errors.js";
import { browse, retrieve, routeList, rulesAnswer, search } from "./find.js";
import { sections } from "./sections.js";
import { Guard, type GuardSession } from "./guard.js";
import { exitCode, gstIncluded } from "./money.js";
import { DEMO_LOGINS, StoreTeam, type Caller } from "./team.js";
import type { DemoProduct } from "./types.js";

export const DEMO_CHANNEL = "smartcart-demo";
export const STORE_ID = "S-01";
const STORE_NAME = "DMart Pilot Store (demo)";
/** Carts by the entrance in the app demo. The dashboard demo's simulated shoppers never take these. */
export const DEMO_APP_CARTS = ["C-0007", "C-0012", "C-0015", "C-0019"];

/** Messages between the shopper app demo and the dashboard demo. */
export type BridgeMessage =
  /** From the dashboard every few seconds; `fresh` on its first, asking for a `sync`. */
  | { kind: "hello"; fresh?: boolean }
  /** The app's carts and help requests so far, for a dashboard opened after they started. */
  | { kind: "sync"; sessions: BridgeSession[]; help: HelpRequest[] }
  | { kind: "event"; event: SmartCartEvent; shopperName?: string }
  | { kind: "order"; order: BridgeOrder }
  /** A store-team account approved in one demo tab, so the other can sign it in. Demo only. */
  | { kind: "staff"; account: StaffAccount; password: string }
  /** The dashboard's offers, sent when a manager changes one and with each hello. */
  | { kind: "offers"; offers: DemoOffer[] }
  /** A search in the app, so the dashboard's Reports count it (spoken ones too). */
  | { kind: "search"; query: string; source: "search" | "voice" | "list" | "assistant"; resultCount: number }
  /** Carts a manager took out of service on the dashboard's Cart fleet page, sent with each hello. */
  | { kind: "fleet"; maintenance: string[] };

export type BridgeSession = {
  sessionId: string;
  cartCode: string;
  shopperName: string;
  startedAt: string;
  status: "active" | "checking_out";
  lines: { productId: string; qty: number }[];
};

export type BridgeOrder = {
  orderId: string;
  cartCode: string;
  shopperName: string;
  status: "paid";
  totalPaise: number;
  taxPaise: number;
  itemCount: number;
  exitCode: string;
  exitUsedAt: string | null;
  createdAt: string;
  receipt: Receipt;
};

export { DemoApiError };

type Session = {
  sessionId: string;
  cartCode: string;
  userId: string;
  shopperName: string;
  startedAt: string;
  status: "active" | "checking_out";
  lines: Map<string, number>;
  lastAisle: string | null;
  orderId: string | null;
  seen: Set<string>;
};

const byId = new Map(catalog.map((p) => [p.productId, p]));
const byBarcode = new Map(catalog.map((p) => [p.barcode, p]));
const uuid = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();

/** Sample shelf for the demo scan screen: one product from each aisle. */
export const demoShelf: DemoProduct[] = [
  "Amul Toned Milk 500 ml",
  "Amul Fresh Paneer 200 g",
  "Britannia Sandwich Bread 400 g",
  "Tata Sampann Toor Dal 1 kg",
  "Aashirvaad Whole Wheat Atta 5 kg",
  "Everest Turmeric Powder 100 g",
  "Red Label Tea 250 g",
  "Parle-G Biscuits 250 g",
  "Maggi Masala Noodles 70 g",
  "Dove Shampoo 180 ml",
  "Surf Excel Detergent Powder 1 kg",
].flatMap((name) => catalog.filter((p) => p.name === name));

export class ShopperDemo {
  private onHand = new Map(catalog.map((p) => [p.productId, p.onHand]));
  private reserved = new Map(catalog.map((p) => [p.productId, 0]));
  private sessions = new Map<string, Session>();
  private orders = new Map<string, Receipt & { userId: string; shopperName: string }>();
  private help: (HelpRequest & { userId: string })[] = [];
  private listeners = new Map<string, Set<(e: SmartCartEvent) => void>>();
  private channel: BroadcastChannel | null = null;
  private dashboardSeenAt = 0;
  readonly team: StoreTeam;
  readonly deals = new Deals();
  /** This tab's carts: weighed here, and their alerts sent to the dashboard demo. */
  readonly guard = new Guard({
    storeId: STORE_ID,
    sessionFor: (code) => this.guardSession(code),
    weighs: (code) => this.guardSession(code) !== null,
    emit: (e) => {
      if (e.type === "cart.weight_check") {
        const s = this.sessions.get(e.data.sessionId);
        if (s) this.listeners.get(s.sessionId)?.forEach((l) => l(e));
      }
      this.broadcast(e);
    },
  });
  private sensing: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(DEMO_CHANNEL);
      this.channel.onmessage = (m: MessageEvent<BridgeMessage>) => this.fromDashboard(m.data);
    }
    this.team = new StoreTeam({
      storeId: STORE_ID,
      available: (id) => this.available(id),
      onHand: (id) => this.onHand.get(id) ?? 0,
      reservedQty: (id) => this.reserved.get(id) ?? 0,
      hold: (id, delta) => this.reserved.set(id, (this.reserved.get(id) ?? 0) + delta),
      setOnHand: (id, onHand) => {
        this.onHand.set(id, onHand);
        this.inventory(byId.get(id)!);
      },
      emit: (e) => this.fromTeam(e),
      cartFree: (code) => ![...this.sessions.values()].some((s) => s.cartCode === code),
      collect: (user, reservation) => this.collect(user, reservation),
    });
    this.team.onAccountCreated(({ account, password }) => this.post({ kind: "staff", account, password }));
  }

  /** True while a dashboard demo is open in this browser and answering help requests. */
  get dashboardOpen() {
    return Date.now() - this.dashboardSeenAt < 12_000;
  }

  /** The REST API, as the app calls it. `token` is the app's dev token: dev:<uid>:<name>. */
  async request(method: string, path: string, body: unknown, token: string | null): Promise<unknown> {
    await new Promise((r) => setTimeout(r, 120)); // feel like a network call
    const url = new URL(path, "http://demo");
    const p = url.pathname;
    const route = (m: string, re: RegExp) => (method === m ? re.exec(p) : null);
    let match: RegExpExecArray | null;

    if (route("GET", /^\/v1\/stores$/)) return { stores: [{ id: STORE_ID, name: STORE_NAME, city: "Mumbai" }] };
    if ((match = route("GET", /^\/v1\/products\/barcode\/(\d+)$/))) {
      const found = byBarcode.get(match[1]!);
      if (!found) throw new DemoApiError(404, "product_not_found");
      const product = this.deals.priced(found);
      return {
        productId: product.productId,
        barcode: product.barcode,
        name: product.name,
        brand: product.brand,
        category: product.category,
        imageUrl: null,
        gstRateBp: product.gstRateBp,
        mrpPaise: product.mrpPaise,
        pricePaise: product.pricePaise,
        inStock: this.available(product.productId) > 0,
        aisle: product.aisle,
      };
    }
    if ((match = route("GET", /^\/v1\/stores\/[^/]+\/products\/search$/))) {
      const q = url.searchParams.get("q") ?? "";
      const results = this.find(q, url.searchParams.getAll("diet"));
      const source = url.searchParams.get("source") === "voice" ? "voice" : "search";
      if (q.trim()) this.post({ kind: "search", query: q, source, resultCount: results.length });
      return { query: q, results: results.slice(0, 20) };
    }
    if (route("GET", /^\/v1\/stores\/[^/]+\/offers$/)) {
      const aisle = url.searchParams.get("aisle");
      const diet = url.searchParams.getAll("diet").flatMap((d) => d.split(",")).filter(Boolean);
      return { storeId: STORE_ID, aisle, offers: this.deals.forShoppers((id) => this.available(id), aisle, diet) } satisfies OffersResponse;
    }
    if (route("GET", /^\/v1\/sections$/)) return sectionsResponse();
    if (route("GET", /^\/v1\/products$/)) return browseResponse(url, (id) => this.available(id), this.deals.catalog());
    if (route("POST", /^\/v1\/stores\/[^/]+\/lists\/route$/)) {
      return routeList((q) => this.find(q), (body as { lines: string[] }).lines) satisfies RouteListResponse;
    }

    const caller = this.caller(token);
    const forTeam = this.team.handle(method, url, body, caller);
    if (forTeam !== undefined) return forTeam;
    if (!caller) throw new DemoApiError(401, "unauthenticated");
    const user = caller.kind === "staff" ? { id: caller.userId, name: caller.name } : caller;

    // Floor staff on the handheld: help inbox and exit checks.
    if (route("GET", /^\/staff\/v1\/stores\/[^/]+\/help$/)) {
      this.staffOnly(caller);
      const requests = this.help.filter((h) => h.status === "open" || h.status === "acknowledged").reverse();
      return { storeId: STORE_ID, requests: requests.map((h) => this.wireHelp(h)) };
    }
    if ((match = route("POST", /^\/staff\/v1\/stores\/[^/]+\/help\/([^/]+)$/))) {
      this.staffOnly(caller);
      const h = this.help.find((x) => x.id === match![1]);
      if (!h) throw new DemoApiError(404, "help_request_not_found");
      if (h.status === "resolved" || h.status === "cancelled") throw new DemoApiError(409, "help_request_closed");
      const action = (body as { action: string }).action;
      h.staffName = user.name;
      this.updateHelp(h, action === "resolve" ? "resolved" : "acknowledged", false);
      return this.wireHelp(h);
    }
    if (route("GET", /^\/staff\/v1\/stores\/[^/]+\/security-alerts$/)) {
      this.staffOnly(caller);
      return { storeId: STORE_ID, alerts: this.guard.list(url.searchParams.get("openOnly") !== "false") };
    }
    if ((match = route("POST", /^\/staff\/v1\/stores\/[^/]+\/security-alerts\/([^/]+)$/))) {
      this.staffOnly(caller);
      const b = body as { action: string; note?: string | null };
      return this.guard.act(match[1]!, b.action, b.note?.trim() || null, user.name);
    }
    if (route("POST", /^\/staff\/v1\/stores\/[^/]+\/exit-checks$/)) {
      this.staffOnly(caller);
      return this.exitCheck(String((body as { code?: string }).code ?? ""));
    }

    if (route("GET", /^\/v1\/me\/cart$/)) {
      const s = this.openSession(user.id);
      return { session: s ? this.snapshot(s) : null };
    }
    if (route("POST", /^\/v1\/carts\/pair$/)) return this.pair(user, (body as { cartCode: string }).cartCode);
    if ((match = route("GET", /^\/v1\/carts\/([^/]+)$/))) return this.snapshot(this.owned(match[1]!, user.id));
    if ((match = route("POST", /^\/v1\/carts\/([^/]+)\/items$/))) {
      const b = body as { barcode: string; qty: number; requestId: string };
      return this.add(this.owned(match[1]!, user.id), b.barcode, b.qty, b.requestId);
    }
    if ((match = route("DELETE", /^\/v1\/carts\/([^/]+)\/items\/([^/]+)$/))) {
      const qty = url.searchParams.get("qty") === "all" ? "all" : 1;
      return this.remove(this.owned(match[1]!, user.id), match[2]!, qty);
    }
    if ((match = route("POST", /^\/v1\/carts\/([^/]+)\/cancel$/))) {
      this.end(this.owned(match[1]!, user.id), "cancelled");
      return { ok: true };
    }
    if ((match = route("POST", /^\/v1\/carts\/([^/]+)\/checkout$/))) return this.checkout(this.owned(match[1]!, user.id));
    if ((match = route("GET", /^\/v1\/orders\/([^/]+)$/))) return this.ownedOrder(match[1]!, user.id);
    if ((match = route("POST", /^\/v1\/orders\/([^/]+)\/back-to-cart$/))) {
      const order = this.ownedOrder(match[1]!, user.id);
      const s = this.sessions.get(order.sessionId);
      if (s) s.status = "active";
      this.orders.delete(order.orderId);
      if (s) s.orderId = null;
      return { ok: true };
    }
    if ((match = route("POST", /^\/v1\/orders\/([^/]+)\/pay\/fake$/))) return this.pay(this.ownedOrder(match[1]!, user.id));
    if (route("GET", /^\/v1\/me\/orders$/)) {
      const orders = [...this.orders.values()]
        .filter((o) => o.userId === user.id && o.status === "paid")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ userId: _u, shopperName: _n, ...r }) => r);
      return { orders };
    }
    if (route("POST", /^\/v1\/stores\/[^/]+\/assistant$/)) {
      const products = retrieve((q) => this.find(q), (body as { message: string }).message);
      return { reply: rulesAnswer(products), mode: "rules", products: products.slice(0, 5) } satisfies AskResponse;
    }
    if (route("POST", /^\/v1\/stores\/[^/]+\/help$/)) {
      const b = body as { topic?: HelpTopic; note?: string | null };
      return this.callHelp(user, b.topic ?? "find_item", b.note ?? null);
    }
    if (route("GET", /^\/v1\/stores\/[^/]+\/help\/mine$/)) {
      const mine = this.help.filter((h) => h.userId === user.id).at(-1);
      return { request: mine ? this.wireHelp(mine) : null };
    }
    if ((match = route("POST", /^\/v1\/stores\/[^/]+\/help\/([^/]+)$/))) {
      const h = this.help.find((x) => x.id === match![1] && x.userId === user.id);
      if (!h) throw new DemoApiError(404, "help_request_not_found");
      this.updateHelp(h, "cancelled", true);
      return this.wireHelp(h);
    }
    throw new DemoApiError(404, "not_available_in_demo");
  }

  /** The app's cart socket: replies with a snapshot like the real join, then pushes events. */
  connect(sessionId: string, onEvent: (e: SmartCartEvent) => void, onLive: (live: boolean) => void): () => void {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(onEvent);
    this.listeners.set(sessionId, set);
    setTimeout(() => {
      const s = this.sessions.get(sessionId);
      onLive(true);
      if (s) onEvent(this.event("cart.snapshot", s.cartCode, "system", this.snapshot(s)));
    }, 50);
    return () => set.delete(onEvent);
  }

  // ---- cart -----------------------------------------------------------------------------------

  private pair(user: { id: string; name: string }, cartCode: string, collecting = false): CartSnapshot {
    const code = cartCode.trim().toUpperCase();
    if (!/^C-\d{4}$/.test(code)) throw new DemoApiError(404, "cart_not_found");
    if (!collecting && this.team.parkedCarts().includes(code)) throw new DemoApiError(409, "cart_reserved");
    const mine = this.openSession(user.id);
    if (mine) {
      if (mine.cartCode === code) return this.snapshot(mine);
      throw new DemoApiError(409, "already_shopping");
    }
    if ([...this.sessions.values()].some((s) => s.cartCode === code)) throw new DemoApiError(409, "cart_in_use");
    if (this.guard.inMaintenance(code)) throw new DemoApiError(409, "cart_in_maintenance");
    const s: Session = {
      sessionId: uuid(),
      cartCode: code,
      userId: user.id,
      shopperName: user.name,
      startedAt: now(),
      status: "active",
      lines: new Map(),
      lastAisle: null,
      orderId: null,
      seen: new Set(),
    };
    this.sessions.set(s.sessionId, s);
    this.sensing ??= setInterval(() => this.sense(), 3_000);
    this.broadcast(
      this.event("cart.session_started", code, "phone", { sessionId: s.sessionId, cartCode: code, userId: user.id }),
      user.name,
    );
    return this.snapshot(s);
  }

  private add(s: Session, barcode: string, qty: number, requestId: string) {
    this.assertActive(s);
    const p = byBarcode.get(barcode);
    if (!p) throw new DemoApiError(404, "product_not_found");
    if (s.seen.has(requestId)) return { line: this.line(p, s.lines.get(p.productId) ?? 0), totals: this.totals(s) };
    s.seen.add(requestId);
    // Simulated scale: an item put in unscanned is usually the next thing the shopper scans.
    if (this.guard.unscannedG(s.cartCode) > 0) {
      this.guard.setUnscanned(s.cartCode, 0);
      setTimeout(() => this.guard.sense(s.cartCode), 800);
    }
    s.lines.set(p.productId, (s.lines.get(p.productId) ?? 0) + qty);
    s.lastAisle = p.aisle;
    this.reserved.set(p.productId, this.reserved.get(p.productId)! + qty);
    const line = this.line(p, s.lines.get(p.productId)!);
    const totals = this.totals(s);
    this.push(s, this.event("cart.item_added", s.cartCode, "phone", { sessionId: s.sessionId, line, totals }));
    this.inventory(p);
    return { line, totals };
  }

  private remove(s: Session, productId: string, qty: 1 | "all") {
    this.assertActive(s);
    const p = byId.get(productId);
    const had = s.lines.get(productId);
    if (!p || !had) throw new DemoApiError(404, "not_in_cart");
    const left = qty === "all" ? 0 : had - 1;
    if (left > 0) s.lines.set(productId, left);
    else s.lines.delete(productId);
    this.reserved.set(productId, this.reserved.get(productId)! - (had - left));
    const line = left > 0 ? this.line(p, left) : null;
    const totals = this.totals(s);
    this.push(s, this.event("cart.item_removed", s.cartCode, "phone", { sessionId: s.sessionId, productId, line, totals }));
    this.inventory(p);
    return { line, totals };
  }

  private checkout(s: Session): CheckoutResponse {
    if (s.lines.size === 0) throw new DemoApiError(409, "cart_empty");
    const existing = s.orderId ? this.orders.get(s.orderId) : undefined;
    const order = existing ?? this.newOrder(s);
    s.status = "checking_out";
    this.push(
      s,
      this.event("cart.checked_out", s.cartCode, "phone", { sessionId: s.sessionId, orderId: order.orderId, totals: order.totals }),
    );
    return {
      order: this.publicOrder(order),
      payment: { provider: "fake", paymentId: `fake_${order.orderId.slice(0, 8)}`, clientSecret: null, publishableKey: null },
    };
  }

  private newOrder(s: Session) {
    const lines = [...s.lines].map(([id, qty]) => this.line(byId.get(id)!, qty));
    const order = {
      orderId: uuid(),
      sessionId: s.sessionId,
      storeId: STORE_ID,
      storeName: STORE_NAME,
      cartCode: s.cartCode,
      status: "pending_payment" as Receipt["status"],
      lines,
      totals: this.totals(s),
      gstSummary: gstSummary(lines),
      exitCode: null as string | null,
      exitQr: null as string | null,
      exitUsedAt: null,
      createdAt: now(),
      userId: s.userId,
      shopperName: s.shopperName,
    };
    this.orders.set(order.orderId, order);
    s.orderId = order.orderId;
    return order;
  }

  private pay(order: Receipt & { userId: string; shopperName: string }): Receipt {
    if (order.status === "paid") return this.publicOrder(order);
    const s = this.sessions.get(order.sessionId);
    order.status = "paid";
    order.exitCode = exitCode();
    order.exitQr = `smartcart://exit?order=${order.orderId}&code=${order.exitCode}`;
    for (const l of order.lines) {
      this.onHand.set(l.productId, this.onHand.get(l.productId)! - l.qty);
      this.reserved.set(l.productId, this.reserved.get(l.productId)! - l.qty);
    }
    const receipt = this.publicOrder(order);
    this.post({
      kind: "order",
      order: {
        orderId: order.orderId,
        cartCode: order.cartCode,
        shopperName: order.shopperName,
        status: "paid",
        totalPaise: order.totals.totalPaise,
        taxPaise: order.totals.taxPaise,
        itemCount: order.totals.itemCount,
        exitCode: order.exitCode,
        exitUsedAt: null,
        createdAt: order.createdAt,
        receipt,
      },
    });
    if (s) {
      this.push(s, this.event("order.paid", s.cartCode, "system", { orderId: order.orderId, sessionId: s.sessionId, totalPaise: order.totals.totalPaise }));
      for (const l of order.lines) this.inventory(byId.get(l.productId)!);
      s.lines.clear();
      this.end(s, "paid");
    }
    return receipt;
  }

  private end(s: Session, reason: "paid" | "cancelled") {
    if (reason === "cancelled") {
      for (const [id, qty] of s.lines) this.reserved.set(id, this.reserved.get(id)! - qty);
    }
    this.push(s, this.event("cart.session_ended", s.cartCode, reason === "paid" ? "system" : "phone", { sessionId: s.sessionId, reason }));
    this.sessions.delete(s.sessionId);
    this.guard.sense(s.cartCode);
    if (this.sessions.size === 0 && this.sensing) {
      clearInterval(this.sensing);
      this.sensing = null;
    }
  }

  // ---- floor help -----------------------------------------------------------------------------

  private callHelp(user: { id: string; name: string }, topic: HelpTopic, note: string | null): HelpRequest {
    const open = this.help.find((h) => h.userId === user.id && (h.status === "open" || h.status === "acknowledged"));
    if (open) return this.wireHelp(open);
    const s = this.openSession(user.id);
    const h = {
      id: uuid(),
      storeId: STORE_ID,
      cartId: s?.cartCode ?? null,
      aisle: s?.lastAisle ?? null,
      topic,
      note: note?.trim() || null,
      status: "open" as HelpRequest["status"],
      shopperName: user.name,
      createdAt: now(),
      acknowledgedAt: null as string | null,
      resolvedAt: null as string | null,
      staffName: null as string | null | undefined,
      userId: user.id,
    };
    this.help.push(h);
    this.pushHelp(h, "help.requested", "phone");
    // Without a dashboard open or staff signed in here, a simulated floor assistant answers.
    setTimeout(() => {
      if (!this.dashboardOpen && !this.team.staffSignedIn && h.status === "open") {
        h.staffName = DEMO_LOGINS[0].name;
        this.updateHelp(h, "acknowledged", false);
      }
    }, 8_000);
    setTimeout(() => {
      if (!this.dashboardOpen && h.status === "acknowledged") this.updateHelp(h, "resolved", false);
    }, 40_000);
    return this.wireHelp(h);
  }

  private updateHelp(h: HelpRequest & { userId: string }, status: HelpRequest["status"], byShopper: boolean) {
    const t = now();
    h.status = status;
    if (status === "acknowledged") h.acknowledgedAt = t;
    if (status === "resolved" || status === "cancelled") {
      h.resolvedAt = t;
      if (status === "resolved") h.acknowledgedAt ??= t;
    }
    this.pushHelp(h, "help.updated", byShopper ? "phone" : "staff");
  }

  private pushHelp(h: HelpRequest & { userId: string }, type: "help.requested" | "help.updated", source: "phone" | "staff") {
    const evt = this.event(type, h.cartId, source, this.wireHelp(h));
    const s = this.openSession(h.userId);
    if (s) this.listeners.get(s.sessionId)?.forEach((l) => l(evt));
    if (source === "phone" || !this.dashboardOpen) this.post({ kind: "event", event: evt, shopperName: h.shopperName ?? undefined });
  }

  private wireHelp(h: HelpRequest & { userId?: string }): HelpRequest {
    const { userId: _u, ...wire } = h;
    return { ...wire };
  }

  // ---- bridge to the dashboard demo -----------------------------------------------------------

  private fromDashboard(msg: BridgeMessage) {
    if (msg.kind === "hello") {
      this.dashboardSeenAt = Date.now();
      if (msg.fresh)
        this.post({
          kind: "sync",
          sessions: [...this.sessions.values()].map((s) => ({
            sessionId: s.sessionId,
            cartCode: s.cartCode,
            shopperName: s.shopperName,
            startedAt: s.startedAt,
            status: s.status,
            lines: [...s.lines].map(([productId, qty]) => ({ productId, qty })),
          })),
          help: this.help.map((h) => this.wireHelp(h)),
        });
      return;
    }
    if (msg.kind === "staff") return this.team.adopt(msg.account, msg.password);
    if (msg.kind === "offers") return this.deals.adopt(msg.offers);
    if (msg.kind === "fleet") return this.guard.setMaintenance(msg.maintenance);
    if (msg.kind === "event" && (msg.event.type === "security.alert" || msg.event.type === "security.updated")) {
      return this.guard.mirror(msg.event.data);
    }
    if (msg.kind !== "event" || msg.event.type !== "help.updated") return;
    const evt = msg.event;
    const h = this.help.find((x) => x.id === evt.data.id);
    if (!h || h.status === evt.data.status) return;
    Object.assign(h, {
      status: evt.data.status,
      acknowledgedAt: evt.data.acknowledgedAt,
      resolvedAt: evt.data.resolvedAt,
      staffName: evt.data.staffName ?? h.staffName,
    });
    const s = this.openSession(h.userId);
    if (s) this.listeners.get(s.sessionId)?.forEach((l) => l(evt));
  }

  private post(msg: BridgeMessage) {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // A closed channel only means no dashboard is listening.
    }
  }

  private broadcast(evt: SmartCartEvent, shopperName?: string) {
    this.post({ kind: "event", event: evt, shopperName });
  }

  // ---- helpers --------------------------------------------------------------------------------

  private push(s: Session, evt: SmartCartEvent) {
    this.listeners.get(s.sessionId)?.forEach((l) => l(evt));
    this.broadcast(evt, s.shopperName);
  }

  private inventory(p: DemoProduct) {
    this.broadcast(
      this.event("inventory.updated", null, "system", {
        productId: p.productId,
        onHand: this.onHand.get(p.productId)!,
        reserved: this.reserved.get(p.productId)!,
      }),
    );
  }

  /** A store-team token issued by the demo's staff sign-in, or the app's dev token: dev:<uid>:<name>. */
  private caller(token: string | null): Caller | null {
    if (!token) return null;
    const staff = this.team.staffFor(token);
    if (staff) return staff;
    const m = /^dev:([^:]+):?(.*)$/.exec(token);
    if (!m) throw new DemoApiError(401, "unauthenticated");
    return { kind: "shopper", id: m[1]!, name: m[2] || "Shopper" };
  }

  private staffOnly(caller: Caller) {
    if (caller.kind !== "staff") throw new DemoApiError(403, "forbidden");
    if (caller.account.mustChangePassword) throw new DemoApiError(403, "password_change_required");
  }

  // ---- store team -----------------------------------------------------------------------------

  private fromTeam(e: SmartCartEvent) {
    if (e.type === "reservation.created" || e.type === "reservation.updated") {
      // Reservations show on the dashboard demo's board.
      this.broadcast(e, e.data.shopperName ?? undefined);
      if (e.type === "reservation.created" && !this.team.staffSignedIn) this.team.simulatePick(e.data.id);
    }
  }

  /** Collecting a picked reservation: the shopper pairs the parked cart, which already holds the items. */
  private collect(user: { id: string; name: string }, reservation: Reservation): CartSnapshot {
    const cart = this.pair(user, reservation.cartCode!, true);
    const s = this.sessions.get(cart.sessionId)!;
    for (const item of reservation.items) {
      const p = byId.get(item.productId);
      if (p) this.add(s, p.barcode, item.qty, `reservation:${reservation.id}:${item.productId}`);
    }
    return this.snapshot(s);
  }

  private exitCheck(raw: string) {
    const code = (raw.includes("code=") ? raw.split("code=")[1]! : raw).trim().toUpperCase();
    const order = [...this.orders.values()].find((o) => o.exitCode === code && o.status === "paid");
    if (!order) return { result: "not_found", order: null };
    const result = order.exitUsedAt ? "already_used" : "ok";
    order.exitUsedAt ??= new Date().toISOString();
    const bagCheck = result === "ok" ? this.guard.bagCheck(order.sessionId) : null;
    return { result, order: this.publicOrder(order), bagCheck };
  }

  // ---- cart hardware (simulated) ----------------------------------------------------------------

  /**
   * Demo only: the shopper puts an item in the basket without scanning it, or takes it out again.
   * The cart's load cell notices within a few seconds; staff are told if it stays that way.
   */
  simulateUnscanned(sessionId: string, inBasket: boolean) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.guard.setUnscanned(s.cartCode, inBasket ? 450 : 0);
    setTimeout(() => this.guard.sense(s.cartCode), 1_200);
  }

  /** Demo only: whether this cart's basket holds an unscanned item. */
  unscannedIn(sessionId: string) {
    const s = this.sessions.get(sessionId);
    return s ? this.guard.unscannedG(s.cartCode) > 0 : false;
  }

  private sense() {
    for (const s of this.sessions.values()) this.guard.sense(s.cartCode);
  }

  private guardSession(cartCode: string): GuardSession | null {
    const s = [...this.sessions.values()].find((x) => x.cartCode === cartCode);
    return s ? { sessionId: s.sessionId, cartCode: s.cartCode, shopperName: s.shopperName, startedAt: s.startedAt, lines: s.lines, lastAisle: s.lastAisle } : null;
  }

  private openSession(userId: string) {
    return [...this.sessions.values()].find((s) => s.userId === userId) ?? null;
  }

  private owned(sessionId: string, userId: string) {
    const s = this.sessions.get(sessionId);
    if (!s || s.userId !== userId) throw new DemoApiError(404, "cart_not_found");
    return s;
  }

  private ownedOrder(orderId: string, userId: string) {
    const o = this.orders.get(orderId);
    if (!o || o.userId !== userId) throw new DemoApiError(404, "order_not_found");
    return o;
  }

  private publicOrder(o: Receipt & { userId: string; shopperName: string }): Receipt {
    const { userId: _u, shopperName: _n, ...r } = o;
    return { ...r, lines: [...r.lines] };
  }

  private assertActive(s: Session) {
    if (s.status !== "active") throw new DemoApiError(409, "cart_checking_out");
  }

  private available(productId: string) {
    return this.onHand.get(productId)! - this.reserved.get(productId)!;
  }

  private find(q: string, diet: string[] = []): SearchResult[] {
    return search(this.deals.catalog(), (id) => this.available(id), q, diet);
  }

  private snapshot(s: Session): CartSnapshot {
    return {
      sessionId: s.sessionId,
      cartCode: s.cartCode,
      storeId: STORE_ID,
      status: s.status,
      lines: [...s.lines].map(([id, qty]) => this.line(byId.get(id)!, qty)).sort((a, b) => a.name.localeCompare(b.name)),
      totals: this.totals(s),
      updatedAt: now(),
    };
  }

  private line(product: DemoProduct, qty: number): CartLine {
    const p = this.deals.priced(product);
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

  private totals(s: Session): CartTotals {
    let totalPaise = 0;
    let taxPaise = 0;
    let itemCount = 0;
    for (const [id, qty] of s.lines) {
      const l = this.line(byId.get(id)!, qty);
      totalPaise += l.lineTotalPaise;
      taxPaise += l.lineTaxPaise;
      itemCount += qty;
    }
    return { totalPaise, taxPaise, subtotalPaise: totalPaise - taxPaise, itemCount };
  }

  private event<T extends SmartCartEvent["type"]>(
    type: T,
    cartId: string | null,
    source: "phone" | "system" | "staff",
    data: Extract<SmartCartEvent, { type: T }>["data"],
  ): SmartCartEvent {
    return { type, eventId: uuid(), storeId: STORE_ID, cartId, source, occurredAt: now(), data } as SmartCartEvent;
  }
}

/** GET /v1/sections: every section with its categories and how many products each holds. */
export function sectionsResponse() {
  const count = new Map<string, number>();
  for (const p of catalog) count.set(p.categoryId, (count.get(p.categoryId) ?? 0) + 1);
  return {
    storeId: STORE_ID,
    sections: sections.map((s) => {
      const categories = s.categories.map((c) => ({ ...c, productCount: count.get(c.id) ?? 0 }));
      return { ...s, productCount: categories.reduce((n, c) => n + c.productCount, 0), categories };
    }),
  };
}

/** GET /v1/products?section=&category=&food_type=&tags= */
export function browseResponse(
  url: URL,
  available: (productId: string) => number,
  products: (DemoProduct & { offer?: SearchResult["offer"] })[] = catalog,
) {
  const list = (key: string) => url.searchParams.getAll(key).flatMap((v) => v.split(",")).filter(Boolean);
  const section = url.searchParams.get("section");
  const category = url.searchParams.get("category");
  if (!section && !category) throw new DemoApiError(400, "section_or_category_required");
  const results = browse(products, available, { section, category, foodTypes: list("food_type"), tags: list("tags") }, sections);
  return { storeId: STORE_ID, section, category, results };
}

function gstSummary(lines: CartLine[]) {
  const byRate = new Map<number, { taxablePaise: number; taxPaise: number }>();
  for (const l of lines) {
    const row = byRate.get(l.gstRateBp) ?? { taxablePaise: 0, taxPaise: 0 };
    row.taxablePaise += l.lineTotalPaise - l.lineTaxPaise;
    row.taxPaise += l.lineTaxPaise;
    byRate.set(l.gstRateBp, row);
  }
  return [...byRate].sort((a, b) => a[0] - b[0]).map(([gstRateBp, r]) => ({ gstRateBp, ...r }));
}
