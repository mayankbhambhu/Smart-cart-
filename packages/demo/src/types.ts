/** One product of the seeded pilot store, as the demo builds see it. */
export type DemoProduct = {
  productId: string;
  barcode: string;
  name: string;
  brand: string | null;
  category: string;
  gstRateBp: number;
  pricePaise: number;
  mrpPaise: number;
  dietTags: string[];
  onHand: number;
  lowStockThreshold: number;
  aisle: string | null;
  shelf: string | null;
};
