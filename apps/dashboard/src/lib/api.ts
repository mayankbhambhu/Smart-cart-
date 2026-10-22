import type { FoodType, StaffRole } from "@smart-cart/contracts";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const STORE_ID = process.env.NEXT_PUBLIC_STORE_ID ?? "S-01";
/**
 * Local development shortcut: with an API in AUTH_MODE=dev, NEXT_PUBLIC_DEV_AUTH_TOKEN=dev:staff-demo
 * (the seeded manager) or dev:admin-demo (the admin team) skips the sign-in page. Unset in real builds.
 */
export const DEV_AUTH_TOKEN = process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN || null;

/**
 * Demo mode (NEXT_PUBLIC_DEMO=1): no API at all. Data and live events come from simulated
 * shoppers in the browser, so the dashboard can be hosted as static files on GitHub Pages.
 */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

/** An error from the API with its machine-readable code ("forbidden", "reason_required", ...). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`${code} (${status})`);
  }
}

/** The signed-in store-team member, kept in this browser for the 12 hours the token lasts. */
export type StaffSession = {
  token: string;
  expiresAt: string;
  name: string;
  staffCode: string;
  role: StaffRole;
  storeId: string;
  mustChangePassword: boolean;
};

const SESSION_KEY = "smartcart.staffSession";
let token: string | null = DEV_AUTH_TOKEN;
let onSignedOut: () => void = () => {};

export const sessionStore = {
  load(): StaffSession | null {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as StaffSession | null;
      return s && Date.parse(s.expiresAt) > Date.now() ? s : null;
    } catch {
      return null;
    }
  },
  save(s: StaffSession | null) {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // Private windows can block storage: the session then lasts until the tab closes.
    }
  },
};

export const setToken = (t: string | null) => {
  token = t ?? DEV_AUTH_TOKEN;
};
export const getToken = () => token;
/** Called when the API says the session is no longer valid (expired, suspended account). */
export const onSessionLost = (fn: () => void) => {
  onSignedOut = fn;
};

export async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    if (DEMO) {
      const { demoStore } = await import("./demo/store");
      return (await demoStore().request(method, path, body, token)) as T;
    }
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        cache: "no-store",
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
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
  } catch (e) {
    const err = e as { status?: number; code?: string; extra?: Record<string, unknown> };
    const apiError = e instanceof ApiError ? e : err.code ? new ApiError(err.status ?? 500, err.code, err.extra ?? {}) : null;
    if (apiError?.status === 401 && path !== "/v1/auth/staff/login") onSignedOut();
    throw apiError ?? e;
  }
}

export const apiGet = <T>(path: string) => apiRequest<T>("GET", path);
export const apiPost = <T>(path: string, body: unknown) => apiRequest<T>("POST", path, body);
export const apiPut = <T>(path: string, body: unknown) => apiRequest<T>("PUT", path, body);
export const apiPatch = <T>(path: string, body: unknown) => apiRequest<T>("PATCH", path, body);

export const formatInr = (paise: number | null) =>
  paise === null
    ? "—"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);

export type InventoryItem = {
  productId: string;
  name: string;
  brand: string | null;
  category: string;
  categoryId: string | null;
  /** The shelf section, such as "Dairy and eggs". */
  section: string | null;
  /** The pack's food label. null means nobody has labelled it yet: never guess one. */
  foodType: FoodType | null;
  dietTags: string[];
  barcode: string | null;
  pricePaise: number | null;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  lowStock: boolean;
  aisle: string | null;
  shelf: string | null;
  updatedAt: string;
};

export type Totals = { totalPaise: number; taxPaise: number; subtotalPaise: number; itemCount: number };

export type ActiveCart = {
  sessionId: string;
  cartCode: string;
  shopperName: string | null;
  status: "active" | "checking_out";
  startedAt: string;
  totals: Totals;
};

export type OrderRow = {
  orderId: string;
  cartCode: string;
  shopperName: string | null;
  status: "pending_payment" | "paid" | "cancelled" | "refunded";
  totalPaise: number;
  taxPaise: number;
  itemCount: number;
  exitCode: string | null;
  exitUsedAt: string | null;
  createdAt: string;
};

/** Open help requests, shared by the nav badge, the alert bar and the Help page. */
export const helpQuery = (openOnly: boolean) => ({
  queryKey: ["help", STORE_ID, openOnly ? "open" : "day"],
  queryFn: () =>
    apiGet<{ requests: import("@smart-cart/contracts").HelpRequest[] }>(
      `/admin/v1/stores/${STORE_ID}/help?openOnly=${openOnly}`,
    ).then((r) => r.requests),
});
