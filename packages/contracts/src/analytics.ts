import { z } from "zod";

/**
 * Milestone 7: GET /admin/v1/stores/{storeId}/analytics?days=7, computed by the API in Python
 * (apps/api/src/smartcart/analytics.py). Hours and dates are in the store's time zone (IST).
 * A null means there isn't enough data to say, never a guess.
 */
const Count = z.number().int().nonnegative();
const Paise = z.number().int();
const Share = z.number().min(0).max(1);

export const DealUplift = z.object({
  offerId: z.string(),
  productId: z.string(),
  name: z.string(),
  title: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  running: z.boolean(),
  unitsDuring: Count,
  /** The same number of days just before it started; null when the store has no sales then. */
  unitsBefore: Count.nullable(),
  unitsPerDayDuring: z.number(),
  unitsPerDayBefore: z.number().nullable(),
  /** Change in units per day against before; null when there was nothing to compare with. */
  upliftPct: z.number().int().nullable(),
});
export type DealUplift = z.infer<typeof DealUplift>;

export const StoreAnalytics = z.object({
  storeId: z.string(),
  days: z.number().int().min(1).max(90),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  timezone: z.literal("Asia/Kolkata"),
  summary: z.object({
    orders: Count,
    revenuePaise: Paise,
    avgBasketPaise: Paise.nullable(),
    avgItems: z.number().nullable(),
    /** From pairing the cart to paying. */
    medianMinutesToPay: z.number().nullable(),
  }),
  /** All 24 hours, 0 = midnight IST. */
  byHour: z.array(z.object({ hour: z.number().int().min(0).max(23), orders: Count, revenuePaise: Paise })).length(24),
  byDay: z.array(z.object({ date: z.iso.date(), orders: Count, revenuePaise: Paise })),
  topProducts: z.array(z.object({ productId: z.string(), name: z.string(), qty: Count, revenuePaise: Paise })),
  categoryMix: z.array(z.object({ section: z.string(), revenuePaise: Paise, share: Share })),
  deals: z.object({
    ordersWithDeal: Count,
    dealShare: Share.nullable(),
    dealUnits: Count,
    savingsPaise: Paise,
    offers: z.array(DealUplift),
  }),
  busyAisles: z.array(z.object({ aisle: z.string(), scans: Count, helpRequests: Count })),
  searches: z.object({ total: Count, voice: Count, voiceShare: Share.nullable(), missed: Count }),
  security: z.object({
    total: Count,
    unscannedItem: Count,
    exitUnpaid: Count,
    clearedByShopper: Count,
    checkedByStaff: Count,
    falseAlarms: Count,
    open: Count,
  }),
});
export type StoreAnalytics = z.infer<typeof StoreAnalytics>;
