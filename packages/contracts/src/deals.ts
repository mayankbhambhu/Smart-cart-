import { z } from "zod";
import { FoodType, StockStatus } from "./assist.js";

/**
 * Milestone 6, aisle deals (US-08). Store managers set every offer; the system never changes a price
 * by itself, and an offer can only lower one. While an offer runs, its price is the product's price
 * everywhere: search, the cart and checkout.
 */
export const OfferTag = z.object({
  id: z.string(),
  title: z.string(),
  /** The price without the offer, for "was ₹52". */
  regularPaise: z.number().int(),
  endsAt: z.iso.datetime(),
});
export type OfferTag = z.infer<typeof OfferTag>;

/** A running deal as shoppers see it, with where to find it. */
export const Offer = z.object({
  id: z.string(),
  title: z.string(),
  productId: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  foodType: FoodType.nullable(),
  aisle: z.string().nullable(),
  shelf: z.string().nullable(),
  stock: StockStatus,
  offerPricePaise: z.number().int(),
  regularPaise: z.number().int(),
  savingsPaise: z.number().int(),
  endsAt: z.iso.datetime(),
});
export type Offer = z.infer<typeof Offer>;

/** GET /v1/stores/{storeId}/offers[?aisle=A2&diet=veg]: running deals in walking order. */
export const OffersResponse = z.object({
  storeId: z.string(),
  aisle: z.string().nullable(),
  offers: z.array(Offer),
});
export type OffersResponse = z.infer<typeof OffersResponse>;

export const OfferStatus = z.enum(["running", "scheduled", "ended"]);
export type OfferStatus = z.infer<typeof OfferStatus>;

/** An offer on the manager's Offers page. */
export const StoreOffer = z.object({
  id: z.string(),
  title: z.string(),
  productId: z.string(),
  name: z.string(),
  aisle: z.string().nullable(),
  shelf: z.string().nullable(),
  offerPricePaise: z.number().int(),
  regularPaise: z.number().int().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  status: OfferStatus,
});
export type StoreOffer = z.infer<typeof StoreOffer>;

/** GET /admin/v1/stores/{storeId}/offers: running, then scheduled, then ended in the last week. */
export const StoreOffersResponse = z.object({ storeId: z.string(), offers: z.array(StoreOffer) });
export type StoreOffersResponse = z.infer<typeof StoreOffersResponse>;

/** POST /admin/v1/stores/{storeId}/offers. Errors: offer_price_not_lower, invalid_offer_window, offer_exists. */
export const OfferCreateRequest = z.object({
  productId: z.string().min(1).max(40),
  title: z.string().min(3).max(80),
  offerPricePaise: z.number().int().positive(),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }),
});
export type OfferCreateRequest = z.infer<typeof OfferCreateRequest>;

/** Where a search came from: typed, or spoken into the mic (US-02). Spoken ones are counted in Reports. */
export const SearchSource = z.enum(["search", "voice"]);
export type SearchSource = z.infer<typeof SearchSource>;
