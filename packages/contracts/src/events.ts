import { z } from "zod";
import { CartLine, CartSnapshot, CartTotals } from "./cart.js";

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
]);
export type SmartCartEvent = z.infer<typeof SmartCartEvent>;
export type SmartCartEventType = SmartCartEvent["type"];

/** Socket.IO room names. */
export const rooms = {
  cart: (sessionId: string) => `cart:${sessionId}`,
  store: (storeId: string) => `store:${storeId}`,
};
