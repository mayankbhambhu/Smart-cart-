import { z } from "zod";

/**
 * Milestone 7: anti-theft and the cart fleet. The cart's load cell is compared with what was scanned;
 * the shopper is nudged first, and the floor is told only if it still doesn't match. Alerts ask staff
 * to check, never accuse; staff decide what happened.
 */
export const WeightCheckStatus = z.enum(["ok", "extra", "missing", "unknown"]);
export type WeightCheckStatus = z.infer<typeof WeightCheckStatus>;

export const SecurityAlertKind = z.enum(["unscanned_item", "exit_unpaid"]);
export type SecurityAlertKind = z.infer<typeof SecurityAlertKind>;

/** "cleared": the cart matched its scans again by itself (the shopper scanned the item). */
export const SecurityAlertStatus = z.enum(["open", "acknowledged", "resolved", "false_alarm", "cleared"]);
export type SecurityAlertStatus = z.infer<typeof SecurityAlertStatus>;

export const SecurityAlert = z.object({
  id: z.string(),
  storeId: z.string(),
  cartId: z.string(),
  sessionId: z.string().nullable(),
  shopperName: z.string().nullable(),
  kind: SecurityAlertKind,
  /** Where the cart was, from its aisle beacon. */
  aisle: z.string().nullable(),
  /** unscanned_item: expectedG, measuredG, diffG. exit_unpaid: gateId, sessionStatus. */
  details: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  status: SecurityAlertStatus,
  note: z.string().nullable(),
  handledBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
});
export type SecurityAlert = z.infer<typeof SecurityAlert>;

export const SecurityAlertsResponse = z.object({ storeId: z.string(), alerts: z.array(SecurityAlert) });
export type SecurityAlertsResponse = z.infer<typeof SecurityAlertsResponse>;

export const SecurityAction = z.object({
  action: z.enum(["acknowledge", "resolve", "false_alarm"]),
  note: z.string().max(200).nullable().optional(),
});
export type SecurityAction = z.infer<typeof SecurityAction>;

export const CartFault = z.enum(["scale_error", "scanner_error", "beacon_lost", "lid_open", "low_battery", "offline"]);
export type CartFault = z.infer<typeof CartFault>;

/** One cart on the Cart fleet page. Hardware fields are null until the cart has sent a reading. */
export const FleetCart = z.object({
  cartId: z.string(),
  status: z.enum(["available", "in_use", "maintenance"]),
  sessionId: z.string().nullable(),
  shopperName: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  batteryPct: z.number().int().nullable(),
  weightG: z.number().int().nullable(),
  aisle: z.string().nullable(),
  seenAt: z.iso.datetime().nullable(),
  faults: z.array(CartFault),
  weightCheck: WeightCheckStatus.nullable(),
  openAlerts: z.number().int(),
});
export type FleetCart = z.infer<typeof FleetCart>;

export const FleetResponse = z.object({ storeId: z.string(), carts: z.array(FleetCart) });
export type FleetResponse = z.infer<typeof FleetResponse>;

/** POST /hw/v1/carts/{cartId}/telemetry, signed with the cart's x-device-key. */
export const TelemetryRequest = z.object({
  batteryPct: z.number().int().min(0).max(100),
  weightG: z.number().int().min(0).max(200_000),
  aisle: z.string().max(8).nullable().optional(),
  faults: z.array(z.string()).max(10).optional(),
});
export type TelemetryRequest = z.infer<typeof TelemetryRequest>;

/** On an exit check: the cart's weight didn't match and nobody has cleared that yet. */
export const BagCheck = z.object({ alertId: z.string(), reason: z.string() });
export type BagCheck = z.infer<typeof BagCheck>;
