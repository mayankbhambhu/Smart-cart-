/** One product of the seeded pilot store, as the demo builds see it. */
export type DemoProduct = {
  productId: string;
  barcode: string;
  name: string;
  brand: string | null;
  category: string;
  categoryId: string;
  section: string;
  foodType: "veg" | "non_veg" | "egg" | "not_food" | null;
  gstRateBp: number;
  pricePaise: number;
  mrpPaise: number;
  dietTags: string[];
  onHand: number;
  lowStockThreshold: number;
  aisle: string | null;
  shelf: string | null;
};
