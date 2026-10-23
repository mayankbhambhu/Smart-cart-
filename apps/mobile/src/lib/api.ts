import type {
  AskResponse,
  BrowseResponse,
  CollectResponse,
  ExitCheckResponse,
  MeResponse,
  PickupSlot,
  ProductSection,
  Reservation,
  StaffLoginResponse,
  StaffTask,
  StockLevel,
  CartLine,
  CartSnapshot,
  CartTotals,
  ChatTurn,
  CheckoutResponse,
  DietTag,
  HelpRequest,
  HelpTopic,
  Receipt,
  RouteListResponse,
  SearchResponse,
  OffersResponse,
  SearchSource,
  SecurityAlert,
  SecurityAlertsResponse,
} from "@smart-cart/contracts";
import { API_URL, DEMO } from "./config";

/** An error response from the API, with its machine-readable code ("cart_in_use", ...). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Anything else the error carried, e.g. retryAfterSeconds on a locked account. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

let authToken: string | null = null;
export const setAuthToken = (token: string | null) => {
  authToken = token;
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (DEMO) {
    const { demo } = await import("./demo");
    const { DemoApiError } = await import("@smart-cart/demo");
    try {
      return (await demo().request(method, path, body, authToken)) as T;
    } catch (e) {
      throw e instanceof DemoApiError ? new ApiError(e.status, e.code, e.extra) : e;
    }
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    const { error, ...details } = data;
    throw new ApiError(res.status, error ?? "unknown", details);
  }
  return data as T;
}

export type Store = { id: string; name: string; city: string };

export type ProductPreview = {
  productId: string;
  barcode: string;
  name: string;
  brand: string | null;
  pricePaise: number;
  mrpPaise: number;
  gstRateBp: number;
  /** Null when the store has no verified stock record. */
  inStock: boolean | null;
  aisle: string | null;
};

/** The changed line (null if it left the cart) and the server's new totals. */
export type LineChange = { line: CartLine | null; totals: CartTotals };

export const api = {
  stores: () => request<{ stores: Store[] }>("GET", "/v1/stores").then((r) => r.stores),

  /** Null when the barcode is not in this store's catalogue. */
  product: (barcode: string, storeId: string) =>
    request<ProductPreview>("GET", `/v1/products/barcode/${barcode}?storeId=${storeId}`).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),

  myCart: () => request<{ session: CartSnapshot | null }>("GET", "/v1/me/cart").then((r) => r.session),
  pair: (cartCode: string, storeId: string) =>
    request<CartSnapshot>("POST", "/v1/carts/pair", { cartCode, storeId }),
  /** requestId must stay the same across retries of one scan, so the server applies it once. */
  addItem: (sessionId: string, barcode: string, qty: number, requestId: string) =>
    request<LineChange>("POST", `/v1/carts/${sessionId}/items`, { barcode, qty, requestId }),
  removeItem: (sessionId: string, productId: string, qty: 1 | "all", requestId: string) =>
    request<LineChange>(
      "DELETE",
      `/v1/carts/${sessionId}/items/${productId}?qty=${qty}&requestId=${requestId}`,
    ),
  cancel: (sessionId: string) => request<{ ok: true }>("POST", `/v1/carts/${sessionId}/cancel`, {}),

  /** Freezes the cart into an order and starts payment. Calling it again resumes the same order. */
  checkout: (sessionId: string) => request<CheckoutResponse>("POST", `/v1/carts/${sessionId}/checkout`, {}),
  order: (orderId: string) => request<Receipt>("GET", `/v1/orders/${orderId}`),
  backToCart: (orderId: string) => request<{ ok: true }>("POST", `/v1/orders/${orderId}/back-to-cart`, {}),
  /** Only when the API runs with PAYMENT_PROVIDER=fake (development and demos). */
  payFake: (orderId: string) => request<Receipt>("POST", `/v1/orders/${orderId}/pay/fake`, {}),
  myOrders: () => request<{ orders: Receipt[] }>("GET", "/v1/me/orders").then((r) => r.orders),

  // ---- Find it fast (milestone 4) ----
  /** source "voice" marks a spoken search, so the store's report can count them. */
  search: (storeId: string, q: string, diet: DietTag[] = [], source: SearchSource = "search") => {
    const params = new URLSearchParams({ q });
    if (source !== "search") params.set("source", source);
    diet.forEach((d) => params.append("diet", d));
    return request<SearchResponse>("GET", `/v1/stores/${storeId}/products/search?${params}`).then((r) => r.results);
  },
  /** Deals running now, optionally only one aisle's, filtered by the shopper's diet (US-08). */
  offers: (storeId: string, aisle: string | null = null, diet: DietTag[] = []) => {
    const params = new URLSearchParams();
    if (aisle) params.set("aisle", aisle);
    diet.forEach((d) => params.append("diet", d));
    return request<OffersResponse>("GET", `/v1/stores/${storeId}/offers?${params}`).then((r) => r.offers);
  },
  routeList: (storeId: string, lines: string[]) =>
    request<RouteListResponse>("POST", `/v1/stores/${storeId}/lists/route`, { lines }),
  ask: (storeId: string, message: string, history: ChatTurn[]) =>
    request<AskResponse>("POST", `/v1/stores/${storeId}/assistant`, { message, history }),
  requestHelp: (storeId: string, topic: HelpTopic, note?: string) =>
    request<HelpRequest>("POST", `/v1/stores/${storeId}/help`, { topic, note: note || null }),
  myHelp: (storeId: string) =>
    request<{ request: HelpRequest | null }>("GET", `/v1/stores/${storeId}/help/mine`).then((r) => r.request),
  cancelHelp: (storeId: string, id: string) =>
    request<HelpRequest>("POST", `/v1/stores/${storeId}/help/${id}`, { action: "cancel" }),

  // ---- Sections (browse by aisle section and food label) ----
  sections: (storeId: string) =>
    request<{ sections: ProductSection[] }>("GET", `/v1/sections?storeId=${storeId}`).then((r) => r.sections),
  browse: (storeId: string, filter: { section?: string; category?: string; foodTypes?: string[]; tags?: string[] }) => {
    const params = new URLSearchParams({ storeId });
    if (filter.section) params.set("section", filter.section);
    if (filter.category) params.set("category", filter.category);
    if (filter.foodTypes?.length) params.set("food_type", filter.foodTypes.join(","));
    if (filter.tags?.length) params.set("tags", filter.tags.join(","));
    return request<BrowseResponse>("GET", `/v1/products?${params}`).then((r) => r.results);
  },

  // ---- Reservations (shopper) ----
  slots: (storeId: string) =>
    request<{ slots: PickupSlot[] }>("GET", `/v1/stores/${storeId}/reservations/slots`).then((r) => r.slots),
  reserve: (storeId: string, items: { productId: string; qty: number }[], slotStart: string) =>
    request<Reservation>("POST", `/v1/stores/${storeId}/reservations`, { items, slotStart }),
  myReservation: (storeId: string) =>
    request<{ reservation: Reservation | null }>("GET", `/v1/stores/${storeId}/reservations/mine`).then((r) => r.reservation),
  cancelReservation: (storeId: string, id: string) =>
    request<Reservation>("DELETE", `/v1/stores/${storeId}/reservations/${id}`),
  collect: (storeId: string, id: string) =>
    request<CollectResponse>("POST", `/v1/stores/${storeId}/reservations/${id}/collect`, {}),

  // ---- Store team ----
  staffLogin: (login: string, password: string) =>
    request<StaffLoginResponse>("POST", "/v1/auth/staff/login", { login, password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("POST", "/v1/auth/staff/password", { currentPassword, newPassword }),
  me: () => request<MeResponse>("GET", "/v1/me"),
};

/** Staff mode on the handheld: everything under /staff/v1/stores/{store}. */
export const staffApi = {
  help: (storeId: string) =>
    request<{ requests: HelpRequest[] }>("GET", `/staff/v1/stores/${storeId}/help`).then((r) => r.requests),
  helpAction: (storeId: string, id: string, action: "acknowledge" | "resolve") =>
    request<HelpRequest>("POST", `/staff/v1/stores/${storeId}/help/${id}`, { action }),
  pickList: (storeId: string) =>
    request<{ reservations: Reservation[] }>("GET", `/staff/v1/stores/${storeId}/reservations/picklist`).then(
      (r) => r.reservations,
    ),
  picked: (storeId: string, id: string, cartCode: string) =>
    request<Reservation>("POST", `/staff/v1/stores/${storeId}/reservations/${id}/picked`, { cartCode }),
  tasks: (storeId: string) =>
    request<{ tasks: StaffTask[] }>("GET", `/staff/v1/stores/${storeId}/tasks`).then((r) => r.tasks),
  taskDone: (storeId: string, id: string, restocked?: number) =>
    request<{ ok: true }>("POST", `/staff/v1/stores/${storeId}/tasks/${id}/done`, restocked ? { restocked } : {}),
  stock: (storeId: string, barcode: string) =>
    request<StockLevel>("GET", `/staff/v1/stores/${storeId}/stock/${encodeURIComponent(barcode)}`),
  correct: (storeId: string, barcode: string, counted: number, reason: string) =>
    request<StockLevel & { delta: number }>("POST", `/staff/v1/stores/${storeId}/stock-corrections`, {
      barcode,
      counted,
      reason,
    }),
  exitCheck: (storeId: string, code: string) =>
    request<ExitCheckResponse>("POST", `/staff/v1/stores/${storeId}/exit-checks`, { code }),
  security: (storeId: string) =>
    request<SecurityAlertsResponse>("GET", `/staff/v1/stores/${storeId}/security-alerts`).then((r) => r.alerts),
  securityAction: (storeId: string, id: string, action: "acknowledge" | "resolve" | "false_alarm") =>
    request<SecurityAlert>("POST", `/staff/v1/stores/${storeId}/security-alerts/${id}`, { action }),
};
