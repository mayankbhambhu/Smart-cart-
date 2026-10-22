import type {
  AskResponse,
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
} from "@smart-cart/contracts";
import { API_URL } from "./config";

/** An error response from the API, with its machine-readable code ("cart_in_use", ...). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

let authToken: string | null = null;
export const setAuthToken = (token: string | null) => {
  authToken = token;
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
  if (!res.ok) throw new ApiError(res.status, data.error ?? "unknown");
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
  search: (storeId: string, q: string, diet: DietTag[] = []) => {
    const params = new URLSearchParams({ q });
    diet.forEach((d) => params.append("diet", d));
    return request<SearchResponse>("GET", `/v1/stores/${storeId}/products/search?${params}`).then((r) => r.results);
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
};
