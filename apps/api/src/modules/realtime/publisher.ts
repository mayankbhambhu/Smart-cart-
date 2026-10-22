import { rooms, type EventSource, type SmartCartEvent } from "@smart-cart/contracts";

export type Publish = (event: SmartCartEvent, toRooms: string[]) => void;

type EventOf<T extends SmartCartEvent["type"]> = Extract<SmartCartEvent, { type: T }>;

/** Builds an event in the shared envelope. Every cart event goes through here. */
export function makeEvent<T extends SmartCartEvent["type"]>(
  type: T,
  fields: { storeId: string; cartId: string | null; source: EventSource; data: EventOf<T>["data"] },
): EventOf<T> {
  return {
    type,
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    ...fields,
  } as unknown as EventOf<T>;
}

export const roomsFor = {
  cart: (sessionId: string, storeId: string) => [rooms.cart(sessionId), rooms.store(storeId)],
  store: (storeId: string) => [rooms.store(storeId)],
};
