import { describe, expect, it } from "vitest";
import { ean13CheckDigit, isValidEan13 } from "./ids.js";
import { SmartCartEvent } from "./events.js";

describe("EAN-13", () => {
  it("computes the check digit", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
  });
});

describe("event envelope", () => {
  it("accepts a cart-sourced event the same as a phone-sourced one", () => {
    const base = {
      type: "cart.session_started",
      eventId: "4b6f6a1e-5a3c-4c6f-9d0e-2b1a3c4d5e6f",
      storeId: "S-01",
      cartId: "C-0042",
      occurredAt: new Date().toISOString(),
      data: { sessionId: "s1", cartCode: "C-0042", userId: "u1" },
    };
    expect(SmartCartEvent.parse({ ...base, source: "phone" }).source).toBe("phone");
    expect(SmartCartEvent.parse({ ...base, source: "cart" }).source).toBe("cart");
  });
});
