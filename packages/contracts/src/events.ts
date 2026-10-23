import { z } from "zod";
import { HelpRequest } from "./assist.js";
import { CartLine, CartSnapshot, CartTotals } from "./cart.js";
import { Reservation } from "./store.js";
import { SecurityAlert, WeightCheckStatus } from "./security.js";

/**
 * Who produced the event. In V1 only the phone produces cart events;
 * in V2 the cart hardware publishes the same events through the MQTT bridge.
 */
export const EventSource = z.enum(["phone", "cart", "system", "staff"]);
export type EventSource = z.infer<typeof EventSource>;

const envelope = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.object({
    type: z.literal(type),
    eventId: z.uuid(),
    storeId: z.string(),
    cartId: z.string().nullable(),
    source: EventSource,
    occurredAt: z.iso.datetime(),
    data,
  });

export const CartSnapshotEvent = envelope("cart.snapshot", CartSnapshot);
export const CartItemAddedEvent = envelope(
  "cart.item_added",
  z.object({ sessionId: z.string(), line: CartLine, totals: CartTotals }),
);
export const CartItemRemovedEvent = envelope(
  "cart.item_removed",
  z.object({
    sessionId: z.string(),
    productId: z.string(),
    /** The line after removal, or null if the product is gone from the cart. */
    line: CartLine.nullable(),
    totals: CartTotals,
  }),
);
export const CartSessionStartedEvent = envelope(
  "cart.session_started",
  z.object({ sessionId: z.string(), cartCode: z.string(), userId: z.string() }),
);
export const CartSessionEndedEvent = envelope(
  "cart.session_ended",
  z.object({ sessionId: z.string(), reason: z.enum(["paid", "abandoned", "cancelled"]) }),
);
export const CartCheckedOutEvent = envelope(
  "cart.checked_out",
  z.object({ sessionId: z.string(), orderId: z.string(), totals: CartTotals }),
);
export const OrderPaidEvent = envelope(
  "order.paid",
  z.object({ orderId: z.string(), sessionId: z.string(), totalPaise: z.number().int() }),
);
export const InventoryUpdatedEvent = envelope(
  "inventory.updated",
  z.object({
    productId: z.string(),
    onHand: z.number().int(),
    reserved: z.number().int(),
  }),
);
export const InventoryLowStockEvent = envelope(
  "inventory.low_stock",
  z.object({
    productId: z.string(),
    name: z.string(),
    onHand: z.number().int(),
    /** onHand minus units sitting in open carts. */
    available: z.number().int(),
    threshold: z.number().int(),
  }),
);
/** A shopper tapped "Call for help"; sent to staff screens and the shopper's own cart room. */
export const HelpRequestedEvent = envelope("help.requested", HelpRequest);
/** Staff acknowledged or resolved it, or the shopper cancelled. */
export const HelpUpdatedEvent = envelope("help.updated", HelpRequest);

/** A shopper reserved items; sent to the store room for the pick list and reservations board. */
export const ReservationCreatedEvent = envelope("reservation.created", Reservation);
/** Picked, collected, cancelled or expired. */
export const ReservationUpdatedEvent = envelope("reservation.updated", Reservation);
/** Tasks changed; screens refetch. taskId is null when several changed at once. */
export const TaskUpdatedEvent = envelope("task.updated", z.object({ taskId: z.string().nullable() }));

/** To the shopper's cart: the basket's weight stopped (or started again) matching the scanned items. */
export const CartWeightCheckEvent = envelope(
  "cart.weight_check",
  z.object({ sessionId: z.string(), status: WeightCheckStatus, diffG: z.number().int().nullable() }),
);
/** To staff screens: a cart needs checking. */
export const SecurityAlertEvent = envelope("security.alert", SecurityAlert);
/** Acknowledged, resolved, marked a false alarm, or cleared by the cart itself. */
export const SecurityUpdatedEvent = envelope("security.updated", SecurityAlert);

export const SmartCartEvent = z.discriminatedUnion("type", [
  CartSnapshotEvent,
  CartItemAddedEvent,
  CartItemRemovedEvent,
  CartSessionStartedEvent,
  CartSessionEndedEvent,
  CartCheckedOutEvent,
  OrderPaidEvent,
  InventoryUpdatedEvent,
  InventoryLowStockEvent,
  HelpRequestedEvent,
  HelpUpdatedEvent,
  ReservationCreatedEvent,
  ReservationUpdatedEvent,
  TaskUpdatedEvent,
  CartWeightCheckEvent,
  SecurityAlertEvent,
  SecurityUpdatedEvent,
]);
export type SmartCartEvent = z.infer<typeof SmartCartEvent>;
export type SmartCartEventType = SmartCartEvent["type"];

/** Socket.IO room names. */
export const rooms = {
  cart: (sessionId: string) => `cart:${sessionId}`,
  store: (storeId: string) => `store:${storeId}`,
};
