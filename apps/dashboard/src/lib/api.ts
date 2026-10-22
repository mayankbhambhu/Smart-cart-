export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const STORE_ID = process.env.NEXT_PUBLIC_STORE_ID ?? "S-01";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
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
