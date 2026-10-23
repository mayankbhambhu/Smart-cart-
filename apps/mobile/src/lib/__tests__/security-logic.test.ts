import type { SecurityAlert } from "@smart-cart/contracts";
import { alertTitle } from "../security-logic";

const base: SecurityAlert = {
  id: "a1",
  storeId: "S-01",
  cartId: "C-0007",
  sessionId: "s1",
  shopperName: "Asha",
  kind: "unscanned_item",
  aisle: "B2",
  details: { expectedG: 1030, measuredG: 1490, diffG: 460 },
  status: "open",
  note: null,
  handledBy: null,
  createdAt: new Date().toISOString(),
  closedAt: null,
};

test("alerts name the cart and round the weight, and never say theft", () => {
  expect(alertTitle(base)).toBe("Cart C-0007: about 450 g more than its scans");
  expect(alertTitle({ ...base, kind: "exit_unpaid", details: { gateId: "G1" } })).toBe("Cart C-0007 at the exit without paying");
  expect(alertTitle(base).toLowerCase()).not.toMatch(/theft|stole|steal/);
});
