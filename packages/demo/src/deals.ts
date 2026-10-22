/**
 * Demo builds' copy of the API's aisle deals (apps/api/src/smartcart/offers.py, US-08): the seed's
 * week-long offers, a manager creating and ending offers, and offer prices flowing into search and
 * the cart. When both demos are open, the dashboard's list wins and is sent to the app.
 */
import type { Offer, OfferCreateRequest, OfferTag, StoreOffer } from "@smart-cart/contracts";
import { catalog } from "./catalog.js";
import { DemoApiError } from "./errors.js";
import { matchesDiet, stockStatus } from "./find.js";
import { seedOffers } from "./seed-offers.js";
import type { DemoProduct } from "./types.js";

/** An offer as the demos store and share it. */
export type DemoOffer = {
  id: string;
  productId: string;
  title: string;
  offerPricePaise: number;
  startsAt: string;
  endsAt: string;
  endedAt: string | null;
};

const MAX_DAYS = 31;
const KEEP_ENDED_DAYS = 7;
const DAY = 86_400_000;
const byId = new Map(catalog.map((p) => [p.productId, p]));
const iso = (ms: number) => new Date(ms).toISOString();

function aisleKey(aisle: string | null, shelf: string | null): [string, number, number] {
  if (!aisle) return ["~", 0, 0];
  const m = /([A-Za-z]+)(\d*)/.exec(aisle);
  return [m ? m[1]!.toUpperCase() : aisle, m ? Number(m[2] || 0) : 0, Number(shelf) || 0];
}
const byWalk = (a: [string, number, number], b: [string, number, number]) =>
  a[0].localeCompare(b[0]) || a[1] - b[1] || a[2] - b[2];

export class Deals {
  private offers: DemoOffer[];
  private listeners = new Set<() => void>();

  constructor() {
    const start = Date.now();
    // Fixed ids, so the app and dashboard tabs agree on which offer is which.
    this.offers = seedOffers.map((o, i) => ({
      id: `demo-offer-${i + 1}`,
      productId: o.productId,
      title: o.title,
      offerPricePaise: o.offerPricePaise,
      startsAt: iso(start - 60_000),
      endsAt: iso(start + o.days * DAY),
      endedAt: null,
    }));
  }

  status(o: DemoOffer, now = Date.now()): StoreOffer["status"] {
    if (o.endedAt || Date.parse(o.endsAt) <= now) return "ended";
    return Date.parse(o.startsAt) > now ? "scheduled" : "running";
  }

  /** The offer in force for a product: the lowest running one below its regular price. */
  running(productId: string): DemoOffer | null {
    const p = byId.get(productId);
    if (!p) return null;
    return (
      this.offers
        .filter((o) => o.productId === productId && this.status(o) === "running" && o.offerPricePaise < p.pricePaise)
        .sort((a, b) => a.offerPricePaise - b.offerPricePaise)[0] ?? null
    );
  }

  /** A product with its offer price applied, as search, the cart and checkout should see it. */
  priced<P extends DemoProduct>(p: P): P & { offer: OfferTag | null } {
    const o = this.running(p.productId);
    if (!o) return { ...p, offer: null };
    return {
      ...p,
      pricePaise: o.offerPricePaise,
      offer: { id: o.id, title: o.title, regularPaise: p.pricePaise, endsAt: o.endsAt },
    };
  }

  catalog(): (DemoProduct & { offer: OfferTag | null })[] {
    return catalog.map((p) => this.priced(p));
  }

  /** GET /v1/stores/{id}/offers[?aisle=&diet=] */
  forShoppers(available: (productId: string) => number, aisle: string | null = null, diet: string[] = []): Offer[] {
    const want = aisle?.trim().toUpperCase() || null;
    return this.offers
      .filter((o) => this.status(o) === "running" && this.running(o.productId)?.id === o.id)
      .map((o) => ({ o, p: byId.get(o.productId)! }))
      .filter(({ p }) => (!want || p.aisle === want) && matchesDiet(p, diet))
      .sort((a, b) => byWalk(aisleKey(a.p.aisle, a.p.shelf), aisleKey(b.p.aisle, b.p.shelf)) || a.p.name.localeCompare(b.p.name))
      .map(({ o, p }) => ({
        id: o.id,
        title: o.title,
        productId: p.productId,
        name: p.name,
        brand: p.brand,
        foodType: p.foodType,
        aisle: p.aisle,
        shelf: p.shelf,
        stock: stockStatus(available(p.productId), p.lowStockThreshold),
        offerPricePaise: o.offerPricePaise,
        regularPaise: p.pricePaise,
        savingsPaise: p.pricePaise - o.offerPricePaise,
        endsAt: o.endsAt,
      }));
  }

  /** GET /admin/v1/stores/{id}/offers */
  forManagers(): StoreOffer[] {
    const now = Date.now();
    const since = now - KEEP_ENDED_DAYS * DAY;
    const order = { running: 0, scheduled: 1, ended: 2 };
    return this.offers
      .filter((o) => Date.parse(o.endsAt) >= since && (!o.endedAt || Date.parse(o.endedAt) >= since))
      .map((o) => this.wire(o, now))
      .sort(
        (a, b) =>
          order[a.status] - order[b.status] ||
          (a.status === "scheduled" ? a.startsAt.localeCompare(b.startsAt) : a.endsAt.localeCompare(b.endsAt)),
      );
  }

  /** POST /admin/v1/stores/{id}/offers, with the API's checks. */
  create(body: OfferCreateRequest): StoreOffer {
    const p = byId.get(body.productId);
    if (!p) throw new DemoApiError(404, "product_not_found");
    const title = (body.title ?? "").trim();
    if (title.length < 3 || title.length > 80 || !(body.offerPricePaise > 0)) throw new DemoApiError(400, "validation_failed");
    if (body.offerPricePaise >= p.pricePaise) throw new DemoApiError(400, "offer_price_not_lower", { regularPaise: p.pricePaise });
    const now = Date.now();
    const starts = body.startsAt ? Math.max(Date.parse(body.startsAt), now) : now;
    const ends = Date.parse(body.endsAt);
    if (!(ends > starts) || ends - starts > MAX_DAYS * DAY) throw new DemoApiError(400, "invalid_offer_window", { maxDays: MAX_DAYS });
    const clash = this.offers.find(
      (o) => o.productId === p.productId && !o.endedAt && Date.parse(o.startsAt) < ends && Date.parse(o.endsAt) > starts,
    );
    if (clash) throw new DemoApiError(409, "offer_exists", { offerId: clash.id });
    const offer: DemoOffer = {
      id: globalThis.crypto.randomUUID(),
      productId: p.productId,
      title,
      offerPricePaise: body.offerPricePaise,
      startsAt: iso(starts),
      endsAt: iso(ends),
      endedAt: null,
    };
    this.offers.push(offer);
    this.changed();
    return this.wire(offer, now);
  }

  /** POST /admin/v1/stores/{id}/offers/{offerId}/end */
  end(offerId: string): StoreOffer {
    const o = this.offers.find((x) => x.id === offerId);
    if (!o) throw new DemoApiError(404, "offer_not_found");
    if (this.status(o) === "ended") throw new DemoApiError(409, "offer_ended");
    o.endedAt = iso(Date.now());
    this.changed();
    return this.wire(o, Date.now());
  }

  /** Every offer, to send to the other demo tab. */
  all(): DemoOffer[] {
    return this.offers.map((o) => ({ ...o }));
  }

  /** The other tab's list (the dashboard's, when it is open) replaces this one. */
  adopt(offers: DemoOffer[]) {
    const same = JSON.stringify(offers) === JSON.stringify(this.offers);
    this.offers = offers.map((o) => ({ ...o }));
    if (!same) this.listeners.forEach((l) => l());
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    this.listeners.forEach((l) => l());
  }

  private wire(o: DemoOffer, now: number): StoreOffer {
    const p = byId.get(o.productId)!;
    return {
      id: o.id,
      title: o.title,
      productId: o.productId,
      name: p.name,
      aisle: p.aisle,
      shelf: p.shelf,
      offerPricePaise: o.offerPricePaise,
      regularPaise: p.pricePaise,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      endedAt: o.endedAt,
      status: this.status(o, now),
    };
  }
}
