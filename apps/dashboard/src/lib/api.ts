export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const STORE_ID = process.env.NEXT_PUBLIC_STORE_ID ?? "S-01";
/**
 * Until staff sign in with Firebase, the dashboard uses the API's dev mode as the seeded
 * demo manager. Only works against an API running with AUTH_MODE=dev.
 */
export const AUTH_TOKEN = process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN ?? "dev:staff-demo";

/**
 * Demo mode (NEXT_PUBLIC_DEMO=1): no API at all. Data and live events come from simulated
 * shoppers in the browser, so the dashboard can be hosted as static files on GitHub Pages.
 */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

export async function apiGet<T>(path: string): Promise<T> {
  if (DEMO) {
    const { demoStore } = await import("./demo/store");
    return demoStore().get(path) as Promise<T>;
  }
  const res = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${AUTH_TOKEN}` },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  if (DEMO) {
    const { demoStore } = await import("./demo/store");
    return demoStore().post(path, body) as Promise<T>;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${AUTH_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const formatInr = (paise: number | null) =>
  paise === null
    ? "—"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);

export type InventoryItem = {
  productId: string;
  name: string;
  brand: string | null;
  category: string;
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
