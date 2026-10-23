/**
 * Demo mode: an in-browser stand-in for the API, so the dashboard can be hosted as static files
 * (GitHub Pages) and clicked through without a server. It answers the same GET requests and emits
 * the same SmartCartEvents as the real API, from simulated shoppers, so the pages run unchanged.
 *
 * When the shopper app demo is open in the same browser, its cart, payment and help requests join
 * the simulated ones over a BroadcastChannel, and staff answering a help request here updates the app.
 * Store-team sign-in, staff accounts, reservations and tasks come from the shared StoreTeam; accounts
 * approved here can sign in on the app's staff mode, and the app's reservations show on the board.
 * Offers made on the Offers page are sent to the app, which prices and announces them by aisle.
 */
import type {
  AskResponse,
  ExitCheckResponse,
  HelpRequest,
  OfferCreateRequest,
  HelpTopic,
  Receipt,
  SearchResult,
  SmartCartEvent,
  StoreInsights,
} from "@smart-cart/contracts";
import type { ActiveCart, InventoryItem, OrderRow, Totals } from "../api";
import {
  browseResponse,
  catalog,
  Deals,
  DEMO_APP_CARTS,
  DEMO_CHANNEL,
  DemoApiError,
  exitCode,
  gstIncluded,
  retrieve,
  routeList,
  rulesAnswer,
  search,
  sectionsResponse,
  StoreTeam,
  PICKUP_CARTS,
  type BridgeMessage,
  type Caller,
  type DemoProduct,
} from "@smart-cart/demo";

type Product = DemoProduct;
type Session = {
  sessionId: string;
  cartCode: string;
  shopperName: string;
  startedAt: string;
  status: "active" | "checking_out";
  lines: Map<string, number>;
  lastAisle: string | null;
  /** A shopper using the app demo in another tab, not one of the simulated ones. */
  fromApp?: boolean;
};

type SearchLogRow = { query: string; source: string; resultCount: number; at: number };

type DemoOrder = OrderRow & { session: Session; receipt?: Receipt };

const STORE = "S-01";
const SHOPPERS = [
  "Asha Patil", "Rohan Mehta", "Meera Iyer", "Kabir Shah", "Ananya Rao", "Vikram Nair",
  "Priya Desai", "Arjun Kulkarni", "Sneha Joshi", "Farhan Qureshi", "Divya Menon", "Rahul Gupta",
];
/** Things shoppers look for that this store doesn't stock: what the Insights page should surface. */
const MISSING = ["jeera", "rajma", "sabudana", "olive oil", "oats", "peanut butter", "green tea", "brown bread", "sabudana", "jeera", "jeera", "rajma"];
const HELP_NOTES: [HelpTopic, string | null][] = [
  ["find_item", "Where is jeera?"],
  ["stock", "Amul butter 500 g shelf is empty"],
  ["price", "Shelf price differs from the app"],
  ["find_item", null],
  ["other", "Need a bigger cart"],
];
const SHOPPER_VIEW_NAME = "You (shopper view)";
const TICK_MS = 2500;
const MAX_CARTS = 8;

const byId = new Map<string, Product>(catalog.map((p) => [p.productId, p]));
const uuid = () => crypto.randomUUID();
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

class DemoStore {
  private onHand = new Map(catalog.map((p) => [p.productId, p.onHand]));
  private reserved = new Map(catalog.map((p) => [p.productId, 0]));
  private updatedAt = new Map(catalog.map((p) => [p.productId, new Date().toISOString()]));
  private sessions = new Map<string, Session>();
  private orders: DemoOrder[] = [];
  private searchLog: SearchLogRow[] = [];
  private help: HelpRequest[] = [];
  private listeners = new Set<(e: SmartCartEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private pausedListeners = new Set<(paused: boolean) => void>();
  private channel: BroadcastChannel | null = null;
  private appHelp = new Set<string>();
  /** Food labels a manager corrected on the Inventory page. */
  private labels = new Map<string, Product["foodType"]>();
  paused = false;
  readonly deals = new Deals();
  readonly team = new StoreTeam({
    storeId: STORE,
    available: (id) => this.available(id),
    onHand: (id) => this.onHand.get(id) ?? 0,
    reservedQty: (id) => this.reserved.get(id) ?? 0,
    hold: (id, delta) => {
      this.reserved.set(id, (this.reserved.get(id) ?? 0) + delta);
      this.touch(id);
    },
    setOnHand: (id, onHand) => {
      const p = byId.get(id)!;
      const was = this.available(id);
      this.onHand.set(id, onHand);
      this.touch(id);
      this.stockChanged(p, null, was);
    },
    emit: (e) => this.emit(e),
    cartFree: (code) => ![...this.sessions.values()].some((s) => s.cartCode === code),
  });

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
    // A week of searches (some for things the store doesn't stock) and earlier help requests.
    const words = ["milk", "atta", "haldi", "toor dal", "shampoo", "paneer", "biscuits", "rice", "chai", "ghee"];
    const spoken = ["haldi kahan milega", "चीनी कहाँ है", "where is the ghee", "doodh kahan hai", "मुझे आटा चाहिए"];
    for (let i = 0; i < 160; i++) {
      const voice = i % 7 === 3;
      const q = voice ? spoken[i % spoken.length]! : i % 5 === 0 ? MISSING[i % MISSING.length]! : words[i % words.length]!;
      const source = voice ? "voice" : i % 3 === 0 ? "list" : "search";
      this.logSearch(q, source, this.find(q).length, Date.now() - (i * 61 + 7) * 60_000);
    }
    for (let i = 0; i < 9; i++) {
      const [topic, note] = HELP_NOTES[i % HELP_NOTES.length]!;
      const at = Date.now() - (300 + i * 380) * 60_000;
      this.help.push({
        id: uuid(),
        storeId: STORE,
        cartId: `C-${String((i % 20) + 1).padStart(4, "0")}`,
        aisle: pick(["A1", "B1", "B2", "B3", "C2", "D1"]),
        topic,
        note,
        status: "resolved",
        shopperName: pick(SHOPPERS),
        createdAt: new Date(at).toISOString(),
        acknowledgedAt: new Date(at + (1 + (i % 4)) * 60_000).toISOString(),
        resolvedAt: new Date(at + (4 + (i % 5)) * 60_000).toISOString(),
      });
    }
    const waiting = [...this.sessions.values()][0];
    if (waiting) this.callHelp(waiting, "find_item", "Where is jeera?", false, Date.now() - 2 * 60_000);

    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(DEMO_CHANNEL);
      this.channel.onmessage = (m: MessageEvent<BridgeMessage>) => this.fromApp(m.data);
      // Accounts approved here can sign in on the app's Store team tab. Sent again with each hello,
      // so an app tab opened after the approval still gets them.
      const issued = new Map<string, BridgeMessage>();
      this.team.onAccountCreated(({ account, password }) => {
        const msg = { kind: "staff", account, password } satisfies BridgeMessage;
        issued.set(account.id, msg);
        this.channel?.postMessage(msg);
      });
      // Tells the app demo a dashboard is open, so staff here (not a simulated one) answer help.
      const hello = (fresh: boolean) => this.channel?.postMessage({ kind: "hello", fresh } satisfies BridgeMessage);
      // The dashboard's offers are the store's offers: sent on every change and with each hello.
      const offers = () => this.channel?.postMessage({ kind: "offers", offers: this.deals.all() } satisfies BridgeMessage);
      this.deals.onChange(offers);
      hello(true);
      offers();
      setInterval(() => {
        hello(false);
        offers();
        issued.forEach((m) => this.channel?.postMessage(m));
      }, 5_000);
    }
  }

  // ---- REST stand-in -------------------------------------------------------------------------

  /** The REST API as the dashboard calls it. `token` is a store-team token from the demo sign-in. */
  async request(method: string, path: string, body: unknown, token: string | null): Promise<unknown> {
    await new Promise((r) => setTimeout(r, 150)); // feel like a network call
    const url = new URL(path, "http://demo");
    const caller = this.team.staffFor(token);
    const forTeam = this.team.handle(method, url, body, caller);
    if (forTeam !== undefined) return forTeam;
    if (method === "GET" && url.pathname === "/v1/sections") return sectionsResponse();
    if (method === "GET" && url.pathname === "/v1/products")
      return browseResponse(url, (id) => this.available(id), this.deals.catalog());
    if (method === "GET" && url.pathname === `/v1/stores/${STORE}/offers`) {
      const aisle = url.searchParams.get("aisle");
      const diet = url.searchParams.getAll("diet").flatMap((d) => d.split(",")).filter(Boolean);
      return { storeId: STORE, aisle, offers: this.deals.forShoppers((id) => this.available(id), aisle, diet) };
    }
    // The store pages need a manager (or the admin team), as on the API. The shopper view is open.
    if (url.pathname.startsWith("/admin/")) this.manager(caller);
    const label = method === "PATCH" ? new RegExp(`^/admin/v1/stores/${STORE}/catalog/products/([^/]+)$`).exec(url.pathname) : null;
    if (label) return this.label(label[1]!, body as { foodType?: Product["foodType"] });
    if (url.pathname === `/admin/v1/stores/${STORE}/offers`) {
      if (method === "GET") return { storeId: STORE, offers: this.deals.forManagers() };
      if (method === "POST") return this.deals.create(body as OfferCreateRequest);
    }
    const endOffer = method === "POST" ? new RegExp(`^/admin/v1/stores/${STORE}/offers/([^/]+)/end$`).exec(url.pathname) : null;
    if (endOffer) return this.deals.end(endOffer[1]!);
    if (method === "GET") return this.get(url);
    if (method === "POST") return this.post(url.pathname, body);
    throw new DemoApiError(404, "not_found");
  }

  private label(productId: string, body: { foodType?: Product["foodType"] }) {
    const p = byId.get(productId);
    if (!p) throw new DemoApiError(404, "product_not_found");
    if (body.foodType !== undefined) this.labels.set(productId, body.foodType);
    const item = this.item(p);
    return { productId, name: p.name, category: p.category, categoryId: p.categoryId, foodType: item.foodType, dietTags: item.dietTags };
  }

  private manager(caller: Caller | null) {
    if (!caller) throw new DemoApiError(401, "unauthenticated");
    if (caller.kind !== "staff" || caller.account.role === "floor_staff") throw new DemoApiError(403, "forbidden");
    if (caller.account.mustChangePassword) throw new DemoApiError(403, "password_change_required");
  }

  private get(url: URL): unknown {
    const path = url.pathname;
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
    if (url.pathname === `/v1/stores/${STORE}/products/search`) {
      const q = url.searchParams.get("q") ?? "";
      const results = this.find(q, url.searchParams.getAll("diet"));
      this.logSearch(q, url.searchParams.get("source") === "voice" ? "voice" : "search", results.length);
      return { query: q, results: results.slice(0, 20) };
    }
    if (url.pathname === `/v1/stores/${STORE}/help/mine`) {
      return { request: this.help.find((h) => h.shopperName === SHOPPER_VIEW_NAME) ?? null };
    }
    if (url.pathname === `/admin/v1/stores/${STORE}/help`) {
      const openOnly = url.searchParams.get("openOnly") !== "false";
      const dayAgo = Date.now() - 86_400_000;
      const requests = this.help
        .filter((h) => (openOnly ? h.status === "open" || h.status === "acknowledged" : Date.parse(h.createdAt) >= dayAgo))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { storeId: STORE, requests };
    }
    if (url.pathname === `/admin/v1/stores/${STORE}/insights`) return this.insights(Number(url.searchParams.get("days") ?? 7));
    throw new DemoApiError(404, "not_available_in_demo", { path });
  }

  private post(path: string, body: unknown): unknown {
    if (path === `/admin/v1/stores/${STORE}/exit-checks`) {
      const raw = String((body as { code?: string }).code ?? "");
      const code = (raw.includes("code=") ? raw.split("code=")[1]! : raw).trim().toUpperCase();
      const order = this.orders.find((o) => o.exitCode === code);
      if (!order) return { result: "not_found", order: null } satisfies ExitCheckResponse;
      const result = order.exitUsedAt ? "already_used" : "ok";
      order.exitUsedAt ??= new Date().toISOString();
      return { result, order: this.receipt(order) } satisfies ExitCheckResponse;
    }
    if (path === `/v1/stores/${STORE}/lists/route`) {
      const lines = (body as { lines: string[] }).lines;
      return routeList((q) => {
        const r = this.find(q);
        this.logSearch(q, "list", r.length);
        return r;
      }, lines);
    }
    if (path === `/v1/stores/${STORE}/assistant`) {
      const message = (body as { message: string }).message;
      const products = retrieve((q) => this.find(q), message);
      this.logSearch(message, "assistant", products.length);
      return { reply: rulesAnswer(products), mode: "rules", products: products.slice(0, 5) } satisfies AskResponse;
    }
    if (path === `/v1/stores/${STORE}/help`) {
      const existing = this.help.find(
        (h) => h.shopperName === SHOPPER_VIEW_NAME && (h.status === "open" || h.status === "acknowledged"),
      );
      if (existing) return existing;
      const { topic = "find_item", note = null } = body as { topic?: HelpTopic; note?: string | null };
      return this.callHelp(null, topic, note, true);
    }
    const helpAction = new RegExp(`^(/admin)?/v1/stores/${STORE}/help/([^/]+)$`).exec(path);
    if (helpAction) {
      const h = this.help.find((x) => x.id === helpAction[2]);
      if (!h) throw new DemoApiError(404, "help_request_not_found");
      const action = (body as { action: string }).action;
      const now = new Date().toISOString();
      if (action === "acknowledge") Object.assign(h, { status: "acknowledged", acknowledgedAt: now });
      if (action === "resolve") Object.assign(h, { status: "resolved", resolvedAt: now, acknowledgedAt: h.acknowledgedAt ?? now });
      if (action === "cancel") Object.assign(h, { status: "cancelled", resolvedAt: now });
      const event: SmartCartEvent = { ...this.envelope(h.cartId, helpAction[1] ? "staff" : "phone"), type: "help.updated", data: { ...h } };
      this.emit(event);
      if (this.appHelp.has(h.id)) this.channel?.postMessage({ kind: "event", event } satisfies BridgeMessage);
      return { ...h };
    }
    throw new DemoApiError(404, "not_available_in_demo", { path });
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
    const s = [...this.sessions.values()].find((x) => !x.fromApp) ?? this.pair(Date.now(), true);
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
    const sessions = [...this.sessions.values()].filter((s) => !s.fromApp);
    const r = Math.random();
    if (sessions.length === 0 || (sessions.length < MAX_CARTS && r < 0.2)) return this.addShopper();
    const paying = sessions.find((s) => s.status === "checking_out");
    if (paying && r < 0.6) return void this.pay(paying, true);
    const shopping = sessions.filter((s) => s.status === "active");
    if (shopping.length === 0) return this.addShopper();
    const s = pick(shopping);
    if (r > 0.97 && !this.help.some((h) => h.shopperName === s.shopperName && h.status !== "resolved")) {
      const [topic, note] = pick(HELP_NOTES);
      return void this.callHelp(s, topic, note, true);
    }
    if (r > 0.9) return this.logSearch(pick(MISSING), "search", 0);
    const items = [...s.lines.values()].reduce((a, b) => a + b, 0);
    if (r < 0.3 && items >= 4) return this.checkout(s);
    if (r < 0.38 && s.lines.size > 0) return this.removeOne(s);
    this.add(s, true);
  }

  private pair(startedAt: number, emit: boolean): Session | null {
    // App-demo carts and carts parked at the pickup point are never taken by simulated shoppers.
    const used = new Set([...this.sessions.values()].map((s) => s.cartCode).concat(DEMO_APP_CARTS, PICKUP_CARTS));
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
      lastAisle: null,
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
    s.lastAisle = p.aisle;
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
      exitCode: exitCode(),
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

  private find(q: string, diet: string[] = []): SearchResult[] {
    return search(this.deals.catalog(), (id) => this.available(id), q, diet);
  }

  private logSearch(query: string, source: string, resultCount: number, at = Date.now()) {
    if (query.trim()) this.searchLog.push({ query: query.trim().toLowerCase(), source, resultCount, at });
  }

  private callHelp(s: Session | null, topic: HelpTopic, note: string | null, emit: boolean, at = Date.now()): HelpRequest {
    const h: HelpRequest = {
      id: uuid(),
      storeId: STORE,
      cartId: s?.cartCode ?? null,
      aisle: s ? s.lastAisle : null,
      topic,
      note,
      status: "open",
      shopperName: s?.shopperName ?? SHOPPER_VIEW_NAME,
      createdAt: new Date(at).toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
    };
    this.help.push(h);
    if (emit) this.emit({ ...this.envelope(h.cartId, "phone"), type: "help.requested", data: { ...h } });
    return { ...h };
  }

  private insights(days: number): StoreInsights {
    const since = Date.now() - days * 86_400_000;
    const logs = this.searchLog.filter((l) => l.at >= since);
    const missed = new Map<string, { count: number; lastAt: number }>();
    for (const l of logs.filter((x) => x.resultCount === 0)) {
      const m = missed.get(l.query) ?? { count: 0, lastAt: 0 };
      missed.set(l.query, { count: m.count + 1, lastAt: Math.max(m.lastAt, l.at) });
    }
    const topMissed = [...missed]
      .sort((a, b) => b[1].count - a[1].count || b[1].lastAt - a[1].lastAt)
      .slice(0, 15)
      .map(([query, m]) => ({ query, count: m.count, lastAt: new Date(m.lastAt).toISOString() }));
    const help = this.help.filter((h) => Date.parse(h.createdAt) >= since);
    const waits = help.filter((h) => h.acknowledgedAt).map((h) => (Date.parse(h.acknowledgedAt!) - Date.parse(h.createdAt)) / 60_000);
    const count = (key: (h: HelpRequest) => string | null) => {
      const out: Record<string, number> = {};
      for (const h of help) {
        const k = key(h);
        if (k) out[k] = (out[k] ?? 0) + 1;
      }
      return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
    };
    return {
      days,
      searches: logs.length,
      missedSearches: topMissed.reduce((n, m) => n + m.count, 0),
      voiceSearches: logs.filter((l) => l.source === "voice").length,
      topMissed,
      help: {
        total: help.length,
        open: help.filter((h) => h.status === "open" || h.status === "acknowledged").length,
        avgMinutesToAcknowledge: waits.length ? Math.round((waits.reduce((a, b) => a + b, 0) / waits.length) * 10) / 10 : null,
        byTopic: count((h) => h.topic),
        byAisle: count((h) => h.aisle),
      },
    };
  }

  private receipt(o: DemoOrder): Receipt {
    if (o.receipt) return { ...o.receipt, exitUsedAt: o.exitUsedAt };
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

  // ---- the shopper app demo, in another tab ---------------------------------------------------

  private fromApp(msg: BridgeMessage) {
    if (msg.kind === "staff") return this.team.adopt(msg.account, msg.password);
    if (msg.kind === "search") return this.logSearch(msg.query, msg.source, msg.resultCount);
    if (msg.kind === "offers") return;
    if (msg.kind === "sync") {
      for (const app of msg.sessions) {
        if (this.sessions.has(app.sessionId)) continue;
        const s: Session = { ...app, lines: new Map(), lastAisle: null, fromApp: true };
        for (const { productId, qty } of app.lines) {
          s.lines.set(productId, qty);
          this.reserved.set(productId, (this.reserved.get(productId) ?? 0) + qty);
          s.lastAisle = byId.get(productId)?.aisle ?? s.lastAisle;
        }
        this.sessions.set(s.sessionId, s);
      }
      for (const h of msg.help) {
        if (this.help.some((x) => x.id === h.id)) continue;
        this.help.push({ ...h });
        this.appHelp.add(h.id);
      }
      return; // arrives within the first request's simulated network delay, so pages load with it
    }
    if (msg.kind === "order") {
      const { receipt, ...row } = msg.order;
      const session = this.sessions.get(receipt.sessionId);
      if (session && !this.orders.some((o) => o.orderId === row.orderId)) this.orders.push({ ...row, session, receipt });
      return;
    }
    if (msg.kind !== "event") return;
    const e = msg.event;
    if (e.type === "reservation.created" || e.type === "reservation.updated") return this.team.mirror(e.data);
    if (e.type === "cart.session_started") {
      this.sessions.set(e.data.sessionId, {
        sessionId: e.data.sessionId,
        cartCode: e.data.cartCode,
        shopperName: msg.shopperName ?? "App shopper",
        startedAt: e.occurredAt,
        status: "active",
        lines: new Map(),
        lastAisle: null,
        fromApp: true,
      });
    } else if (e.type === "cart.item_added" || e.type === "cart.item_removed") {
      const s = this.sessions.get(e.data.sessionId);
      const productId = e.type === "cart.item_added" ? e.data.line.productId : e.data.productId;
      const p = byId.get(productId);
      if (!s || !p) return;
      const qty = e.data.line?.qty ?? 0;
      const wasAvailable = this.available(productId);
      this.reserved.set(productId, this.reserved.get(productId)! + qty - (s.lines.get(productId) ?? 0));
      if (qty > 0) s.lines.set(productId, qty);
      else s.lines.delete(productId);
      if (e.type === "cart.item_added") s.lastAisle = p.aisle;
      this.touch(productId);
      this.emit(e);
      return this.stockChanged(p, s.cartCode, wasAvailable);
    } else if (e.type === "cart.checked_out") {
      const s = this.sessions.get(e.data.sessionId);
      if (s) s.status = "checking_out";
    } else if (e.type === "order.paid") {
      const s = this.sessions.get(e.data.sessionId);
      for (const [productId, qty] of s?.lines ?? []) {
        this.onHand.set(productId, this.onHand.get(productId)! - qty);
        this.reserved.set(productId, this.reserved.get(productId)! - qty);
        this.touch(productId);
        this.emit({
          ...this.envelope(null, "system"),
          type: "inventory.updated",
          data: { productId, onHand: this.onHand.get(productId)!, reserved: this.reserved.get(productId)! },
        });
      }
      s?.lines.clear();
    } else if (e.type === "cart.session_ended") {
      const s = this.sessions.get(e.data.sessionId);
      for (const [productId, qty] of s?.lines ?? []) this.reserved.set(productId, this.reserved.get(productId)! - qty);
      this.sessions.delete(e.data.sessionId);
    } else if (e.type === "help.requested") {
      if (this.help.some((h) => h.id === e.data.id)) return;
      this.help.push({ ...e.data });
      this.appHelp.add(e.data.id);
    } else if (e.type === "help.updated") {
      const h = this.help.find((x) => x.id === e.data.id);
      if (!h) return;
      Object.assign(h, e.data);
    } else return; // inventory events: this tab keeps its own stock figures
    this.emit(e);
  }

  private stockChanged(p: Product, cartCode: string | null, wasAvailable: number) {
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
      categoryId: p.categoryId,
      section: p.section,
      foodType: this.labels.has(p.productId) ? this.labels.get(p.productId)! : p.foodType,
      dietTags: [...p.dietTags],
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

  private line(product: Product, qty: number) {
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

  private envelope(cartId: string | null, source: "phone" | "system" | "staff") {
    return { eventId: uuid(), storeId: STORE, cartId, source, occurredAt: new Date().toISOString() };
  }

  private emit(e: SmartCartEvent) {
    this.listeners.forEach((l) => l(e));
  }
}

let store: DemoStore | null = null;
/** One shared demo store per browser tab, created on first use. */
export const demoStore = () => (store ??= new DemoStore());
