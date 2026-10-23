import { describe, expect, it } from "vitest";
import { computeAnalytics, sampleHistory, type AnalyticsOrder } from "./analytics.js";
import { catalog } from "./catalog.js";

// Same cases as apps/api/tests/test_analytics.py, so the demo and the Python agree.
const UNTIL = Date.parse("2026-10-23T12:00:00Z"); // 17:30 IST
const H = 3_600_000;
const tea = catalog.find((p) => p.name === "Red Label Tea 250 g")!;
const atta = catalog.find((p) => p.name === "Aashirvaad Whole Wheat Atta 5 kg")!;
const none = { scans: [], helpAisles: [], searches: [], alerts: [] };
const order = (hoursAgo: number, productId: string, qty: number, unitPaise: number, minutes = 20): AnalyticsOrder => {
  const paidAt = UNTIL - hoursAgo * H;
  return { startedAt: paidAt - minutes * 60_000, paidAt, totalPaise: qty * unitPaise, lines: [{ productId, qty, unitPaise }] };
};

describe("demo analytics", () => {
  it("buckets sales by IST hour and day", () => {
    const out = computeAnalytics("S-01", 7, UNTIL, [order(1, atta.productId, 1, 30000), order(30, atta.productId, 1, 30000), order(24 * 9, atta.productId, 5, 30000)], [], none);
    expect(out.summary).toMatchObject({ orders: 2, revenuePaise: 60000, avgBasketPaise: 30000, medianMinutesToPay: 20 });
    expect(out.byHour[16]!.orders).toBe(1);
    expect(out.byHour[11]!.orders).toBe(1);
    expect(out.byDay).toHaveLength(8);
    expect(out.byDay.at(-1)).toMatchObject({ date: "2026-10-23", orders: 1 });
  });

  it("compares a deal with the days before it, and says nothing without enough sales", () => {
    const deal = tea.pricePaise - 1500;
    const w = { id: "of1", productId: tea.productId, title: "Tea week", offerPricePaise: deal, startsAt: UNTIL - 96 * H, endsAt: UNTIL - 48 * H };
    const before = Array.from({ length: 5 }, (_, i) => order(120 + i, tea.productId, 1, tea.pricePaise));
    const during = Array.from({ length: 5 }, (_, i) => order(72 + i, tea.productId, 3, deal));
    const up = computeAnalytics("S-01", 7, UNTIL, [...before, ...during], [w], none).deals;
    expect(up).toMatchObject({ ordersWithDeal: 5, dealUnits: 15, savingsPaise: 15 * 1500 });
    expect(up.offers[0]).toMatchObject({ unitsBefore: 5, unitsDuring: 15, upliftPct: 200, running: false });
    expect(computeAnalytics("S-01", 7, UNTIL, during, [w], none).deals.offers[0]!.upliftPct).toBeNull();
    expect(computeAnalytics("S-01", 7, UNTIL, [...before.slice(0, 2), ...during], [w], none).deals.offers[0]!.upliftPct).toBeNull();
  });

  it("generates the same two weeks of history in every tab, with the tea offer lifting tea sales", () => {
    const a = sampleHistory(UNTIL, 14, []);
    const b = sampleHistory(UNTIL, 14, []);
    expect(a.orders.length).toBe(b.orders.length);
    expect(a.orders.length).toBeGreaterThan(500);
    const out = computeAnalytics("S-01", 14, UNTIL, a.orders, a.offers, { ...none, scans: a.scans.map((s) => s.aisle) });
    expect(out.deals.offers[0]!.title).toBe("Tea week");
    expect(out.deals.offers[0]!.upliftPct).toBeGreaterThan(0);
    expect(out.busyAisles.length).toBeGreaterThan(3);
  });
});
