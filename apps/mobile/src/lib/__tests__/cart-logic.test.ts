import type { CartLine, CartSnapshot, CartTotals, SmartCartEvent } from "@smart-cart/contracts";
import { applyEvent, withLine } from "../cart-logic";

const line = (productId: string, name: string, qty: number): CartLine => ({
  productId,
  name,
  brand: null,
  imageUrl: null,
  qty,
  unitPricePaise: 100,
  gstRateBp: 500,
  lineTotalPaise: qty * 100,
  lineTaxPaise: 5 * qty,
});
const totals = (totalPaise: number): CartTotals => ({ totalPaise, taxPaise: 0, subtotalPaise: totalPaise, itemCount: 1 });
const cart: CartSnapshot = {
  sessionId: "s1",
  cartCode: "C-0042",
  storeId: "S-01",
  status: "active",
  lines: [line("a", "Atta", 1)],
  totals: totals(100),
  updatedAt: new Date().toISOString(),
};
const envelope = { eventId: "e", storeId: "S-01", cartId: "C-0042", source: "phone" as const, occurredAt: "" };

test("withLine replaces, adds and removes lines, keeping the server totals", () => {
  let c = withLine(cart, "a", line("a", "Atta", 2), totals(999));
  expect(c.lines[0]!.qty).toBe(2);
  expect(c.totals.totalPaise).toBe(999); // never summed on the phone
  c = withLine(c, "b", line("b", "Butter", 1), totals(999));
  expect(c.lines.map((l) => l.name)).toEqual(["Atta", "Butter"]);
  c = withLine(c, "a", null, totals(100));
  expect(c.lines.map((l) => l.productId)).toEqual(["b"]);
});

test("a snapshot replaces the local cart (how reconnects resync)", () => {
  const fresh = { ...cart, lines: [] };
  const out = applyEvent(cart, { ...envelope, type: "cart.snapshot", data: fresh } as SmartCartEvent);
  expect(out).toEqual({ kind: "cart", cart: fresh });
});

test("adds from the cart hardware apply exactly like adds from the phone", () => {
  const event = {
    ...envelope,
    source: "cart",
    type: "cart.item_added",
    data: { sessionId: "s1", line: line("b", "Butter", 1), totals: totals(200) },
  } as SmartCartEvent;
  const out = applyEvent(cart, event);
  expect(out.kind === "cart" && out.cart.lines.map((l) => l.productId)).toEqual(["a", "b"]);
});

test("ignores events for another session and reports the session ending", () => {
  const other = { ...envelope, type: "cart.item_removed", data: { sessionId: "zz", productId: "a", line: null, totals: totals(0) } };
  expect(applyEvent(cart, other as SmartCartEvent)).toEqual({ kind: "ignore" });
  const ended = { ...envelope, type: "cart.session_ended", data: { sessionId: "s1", reason: "abandoned" } };
  expect(applyEvent(cart, ended as SmartCartEvent)).toEqual({ kind: "ended", reason: "abandoned" });
});

test("checkout freezes the cart and payment ends it with the order id", () => {
  const out = applyEvent(cart, {
    ...envelope,
    type: "cart.checked_out",
    data: { sessionId: "s1", orderId: "o1", totals: totals(100) },
  } as SmartCartEvent);
  expect(out.kind === "cart" && out.cart.status).toBe("checking_out");
  const paid = applyEvent(cart, {
    ...envelope,
    type: "order.paid",
    data: { orderId: "o1", sessionId: "s1", totalPaise: 100 },
  } as SmartCartEvent);
  expect(paid).toEqual({ kind: "paid", orderId: "o1" });
  const other = applyEvent(cart, {
    ...envelope,
    type: "order.paid",
    data: { orderId: "o2", sessionId: "s2", totalPaise: 100 },
  } as SmartCartEvent);
  expect(other.kind).toBe("ignore");
});

describe("floor help events", () => {
  it("passes help updates through to the help banner", () => {
    const request = {
      id: "h1",
      storeId: "S-01",
      cartId: "C-0001",
      aisle: "B1",
      topic: "find_item" as const,
      note: null,
      status: "acknowledged" as const,
      shopperName: "Priya",
      createdAt: "2026-10-22T10:00:00Z",
      acknowledgedAt: "2026-10-22T10:01:00Z",
      resolvedAt: null,
    };
    const outcome = applyEvent(null, {
      type: "help.updated",
      eventId: "6f1c1d1e-0000-4000-8000-000000000001",
      storeId: "S-01",
      cartId: "C-0001",
      source: "staff",
      occurredAt: "2026-10-22T10:01:00Z",
      data: request,
    });
    expect(outcome).toEqual({ kind: "help", request });
  });
});

test("passes the cart's weight check on to the shopper, for their own cart only", () => {
  const check = { ...envelope, source: "cart", type: "cart.weight_check", data: { sessionId: "s1", status: "extra", diffG: 450 } };
  expect(applyEvent(cart, check as SmartCartEvent)).toEqual({ kind: "weight", status: "extra", diffG: 450 });
  const other = { ...check, data: { ...check.data, sessionId: "zz" } };
  expect(applyEvent(cart, other as SmartCartEvent)).toEqual({ kind: "ignore" });
});
