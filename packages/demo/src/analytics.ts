/**
 * Demo builds' copy of the API's store analytics (apps/api/src/smartcart/analytics.py, where the real
 * numbers are computed in Python), plus two weeks of sample trading so the Analytics page has history.
 * The rules match the Python: IST hours and dates, deal uplift against the same number of days before
 * the offer, and null wherever there isn't enough data to say.
 */
import type { StoreAnalytics } from "@smart-cart/contracts";
import { catalog } from "./catalog.js";
import type { DemoProduct } from "./types.js";

export type AnalyticsOrder = {
  startedAt: number;
  paidAt: number;
  totalPaise: number;
  lines: { productId: string; qty: number; unitPaise: number }[];
};
export type AnalyticsOffer = { id: string; productId: string; title: string; offerPricePaise: number; startsAt: number; endsAt: number };
export type AnalyticsActivity = {
  scans: string[];
  helpAisles: (string | null)[];
  searches: [source: string, results: number][];
  alerts: [kind: string, status: string][];
};

const DAY = 86_400_000;
const IST_MS = 5.5 * 3_600_000;
const MIN_BASELINE_UNITS = 5;
const byId = new Map<string, DemoProduct>(catalog.map((p) => [p.productId, p]));
const iso = (ms: number) => new Date(ms).toISOString();
const istDate = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const istHour = (ms: number) => new Date(ms + IST_MS).getUTCHours();
const rate = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** GET /admin/v1/stores/{id}/analytics?days= — `orders` may start before the window (deal baselines). */
export function computeAnalytics(
  storeId: string,
  days: number,
  until: number,
  orders: AnalyticsOrder[],
  offers: AnalyticsOffer[],
  activity: AnalyticsActivity,
): StoreAnalytics {
  const since = until - days * DAY;
  const win = orders.filter((o) => o.paidAt >= since && o.paidAt < until);
  const revenue = win.reduce((n, o) => n + o.totalPaise, 0);
  const items = (o: AnalyticsOrder) => o.lines.reduce((n, l) => n + l.qty, 0);

  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenuePaise: 0 }));
  const byDay = new Map<string, { date: string; orders: number; revenuePaise: number }>();
  for (let d = Date.parse(istDate(since)); istDate(d - IST_MS) <= istDate(until); d += DAY) {
    const date = new Date(d).toISOString().slice(0, 10);
    byDay.set(date, { date, orders: 0, revenuePaise: 0 });
  }
  const units = new Map<string, number>();
  const productRevenue = new Map<string, number>();
  const sectionRevenue = new Map<string, number>();
  for (const o of win) {
    for (const row of [byHour[istHour(o.paidAt)]!, byDay.get(istDate(o.paidAt))!]) {
      row.orders += 1;
      row.revenuePaise += o.totalPaise;
    }
    for (const l of o.lines) {
      const p = byId.get(l.productId);
      units.set(l.productId, (units.get(l.productId) ?? 0) + l.qty);
      productRevenue.set(l.productId, (productRevenue.get(l.productId) ?? 0) + l.qty * l.unitPaise);
      const section = p?.section ?? "Other";
      sectionRevenue.set(section, (sectionRevenue.get(section) ?? 0) + l.qty * l.unitPaise);
    }
  }
  const sold = [...sectionRevenue.values()].reduce((a, b) => a + b, 0);
  const name = (id: string) => byId.get(id)?.name ?? id;

  const scans = count(activity.scans);
  const help = count(activity.helpAisles.filter((a): a is string => !!a));
  const aisles = [...new Set([...scans.keys(), ...help.keys()])].sort(
    (a, b) => (scans.get(b) ?? 0) - (scans.get(a) ?? 0) || (help.get(b) ?? 0) - (help.get(a) ?? 0) || a.localeCompare(b),
  );
  const status = count(activity.alerts.map(([, s]) => s));
  const kind = count(activity.alerts.map(([k]) => k));
  const voice = activity.searches.filter(([s]) => s === "voice").length;

  return {
    storeId,
    days,
    from: iso(since),
    to: iso(until),
    timezone: "Asia/Kolkata",
    summary: {
      orders: win.length,
      revenuePaise: revenue,
      avgBasketPaise: win.length ? Math.round(revenue / win.length) : null,
      avgItems: win.length ? round1(win.reduce((n, o) => n + items(o), 0) / win.length) : null,
      medianMinutesToPay: win.length ? round1(median(win.map((o) => (o.paidAt - o.startedAt) / 60_000))!) : null,
    },
    byHour,
    byDay: [...byDay.values()],
    topProducts: [...units]
      .sort((a, b) => b[1] - a[1] || productRevenue.get(b[0])! - productRevenue.get(a[0])! || name(a[0]).localeCompare(name(b[0])))
      .slice(0, 10)
      .map(([productId, qty]) => ({ productId, name: name(productId), qty, revenuePaise: productRevenue.get(productId)! })),
    categoryMix: [...sectionRevenue]
      .sort((a, b) => b[1] - a[1])
      .map(([section, r]) => ({ section, revenuePaise: r, share: Math.round((r / sold) * 1000) / 1000 })),
    deals: deals(win, orders, offers, since, until),
    busyAisles: aisles.slice(0, 12).map((aisle) => ({ aisle, scans: scans.get(aisle) ?? 0, helpRequests: help.get(aisle) ?? 0 })),
    searches: { total: activity.searches.length, voice, voiceShare: rate(voice, activity.searches.length), missed: activity.searches.filter(([, n]) => n === 0).length },
    security: {
      total: activity.alerts.length,
      unscannedItem: kind.get("unscanned_item") ?? 0,
      exitUnpaid: kind.get("exit_unpaid") ?? 0,
      clearedByShopper: status.get("cleared") ?? 0,
      checkedByStaff: status.get("resolved") ?? 0,
      falseAlarms: status.get("false_alarm") ?? 0,
      open: (status.get("open") ?? 0) + (status.get("acknowledged") ?? 0),
    },
  };
}

function count(xs: string[]) {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

function deals(win: AnalyticsOrder[], orders: AnalyticsOrder[], offers: AnalyticsOffer[], since: number, until: number): StoreAnalytics["deals"] {
  const onOffer = (productId: string, at: number) => offers.some((w) => w.productId === productId && w.startsAt <= at && at < w.endsAt);
  let dealOrders = 0;
  let dealUnits = 0;
  let savings = 0;
  for (const o of win) {
    const hits = o.lines.filter((l) => {
      const regular = byId.get(l.productId)?.pricePaise;
      return regular && l.unitPaise < regular && onOffer(l.productId, o.paidAt);
    });
    if (hits.length) dealOrders += 1;
    for (const l of hits) {
      dealUnits += l.qty;
      savings += (byId.get(l.productId)!.pricePaise - l.unitPaise) * l.qty;
    }
  }
  const sold = (lo: number, hi: number, productId: string) =>
    orders.filter((o) => o.paidAt >= lo && o.paidAt < hi).reduce((n, o) => n + o.lines.filter((l) => l.productId === productId).reduce((m, l) => m + l.qty, 0), 0);
  const uplift = [...offers]
    .sort((a, b) => a.startsAt - b.startsAt)
    .filter((w) => Math.min(w.endsAt, until) > since && w.startsAt < until)
    .map((w) => {
      const end = Math.min(w.endsAt, until);
      const length = Math.max(end - w.startsAt, DAY); // at least a day either side
      const beforeStart = w.startsAt - length;
      const during = sold(w.startsAt, end, w.productId);
      const before = sold(beforeStart, w.startsAt, w.productId);
      const hadHistory = orders.some((o) => o.paidAt >= beforeStart && o.paidAt < w.startsAt);
      const perDay = length / DAY;
      const comparable = hadHistory && before >= MIN_BASELINE_UNITS && end - w.startsAt >= DAY;
      return {
        offerId: w.id,
        productId: w.productId,
        name: byId.get(w.productId)?.name ?? w.productId,
        title: w.title,
        startsAt: iso(w.startsAt),
        endsAt: iso(w.endsAt),
        running: w.endsAt > until,
        unitsDuring: during,
        unitsBefore: hadHistory ? before : null,
        unitsPerDayDuring: round1(during / perDay),
        unitsPerDayBefore: hadHistory ? round1(before / perDay) : null,
        upliftPct: comparable ? Math.round(((during - before) / before) * 100) : null,
      };
    });
  return { ordersWithDeal: dealOrders, dealShare: rate(dealOrders, win.length), dealUnits, savingsPaise: savings, offers: uplift };
}

// ---- sample history ------------------------------------------------------------------------------

/** Orders by IST hour on a weekday, as in seed_history.py: late-morning and bigger evening peaks. */
const HOURLY: Record<number, number> = { 8: 2, 9: 3, 10: 4, 11: 5, 12: 5, 13: 4, 14: 3, 15: 2, 16: 3, 17: 4, 18: 6, 19: 7, 20: 6, 21: 3 };
const TEA = "Red Label Tea 250 g";

/** A small seeded random generator, so every demo tab gets the same history. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Two weeks of paid orders before the demo opened, with last week's "Tea week" offer. `offers` are the
 * demo's own deals, which sell at their price (and a little more) from when they started.
 */
export function sampleHistory(now: number, days: number, offers: AnalyticsOffer[]): { orders: AnalyticsOrder[]; offers: AnalyticsOffer[]; scans: { aisle: string; at: number }[] } {
  const rand = rng(7);
  const today = Date.parse(istDate(now)) - IST_MS; // IST midnight, in UTC ms
  const tea = catalog.find((p) => p.name === TEA)!;
  const teaStart = today - 9 * DAY + 8 * 3_600_000;
  const teaWeek: AnalyticsOffer = {
    id: "demo-offer-tea-week",
    productId: tea.productId,
    title: "Tea week",
    offerPricePaise: Math.round((tea.pricePaise * 0.85) / 100) * 100,
    startsAt: teaStart,
    endsAt: teaStart + 5 * DAY,
  };
  const all = [teaWeek, ...offers];
  const orders: AnalyticsOrder[] = [];
  const scans: { aisle: string; at: number }[] = [];
  for (let back = days; back >= 0; back--) {
    const midnight = today - back * DAY;
    const weekend = [0, 6].includes(new Date(midnight + IST_MS + 12 * 3_600_000).getUTCDay());
    for (const [h, base] of Object.entries(HOURLY)) {
      const n = Math.round(base * (weekend ? 1.4 : 1) * (0.7 + rand() * 0.6));
      for (let i = 0; i < n; i++) {
        const paidAt = midnight + Number(h) * 3_600_000 + Math.floor(rand() * 60) * 60_000;
        if (paidAt >= now) continue;
        const running = all.filter((w) => w.startsAt <= paidAt && paidAt < w.endsAt);
        const picked = new Set<DemoProduct>();
        const want = 3 + Math.floor(rand() * 10);
        while (picked.size < want) picked.add(catalog[Math.floor(rand() * catalog.length)]!);
        for (const w of running) if (rand() < 0.08) picked.add(byId.get(w.productId)!);
        const lines = [...picked].map((p) => {
          const deal = running.find((w) => w.productId === p.productId);
          const unitPaise = deal ? Math.min(deal.offerPricePaise, p.pricePaise) : p.pricePaise;
          if (p.aisle) scans.push({ aisle: p.aisle, at: paidAt });
          return { productId: p.productId, qty: rand() < 0.75 ? 1 : 2, unitPaise };
        });
        const minutes = 7 + rand() * 31;
        orders.push({ startedAt: paidAt - minutes * 60_000, paidAt, totalPaise: lines.reduce((t, l) => t + l.qty * l.unitPaise, 0), lines });
      }
    }
  }
  return { orders, offers: [teaWeek], scans };
}

