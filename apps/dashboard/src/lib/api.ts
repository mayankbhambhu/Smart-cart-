export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const STORE_ID = process.env.NEXT_PUBLIC_STORE_ID ?? "S-01";
/**
 * Until staff sign in with Firebase, the dashboard uses the API's dev mode as the seeded
 * demo manager. Only works against an API running with AUTH_MODE=dev.
 */
export const AUTH_TOKEN = process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN ?? "dev:staff-demo";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${AUTH_TOKEN}` },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
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
