import { describe, expect, it } from "vitest";
import { cartTotals, gstIncludedPaise } from "./money.js";

describe("GST-inclusive money", () => {
  it("extracts 18% GST from an inclusive price", () => {
    // Rs 118.00 at 18% contains Rs 18.00 of tax.
    expect(gstIncludedPaise(11_800, 1800)).toBe(1800);
  });

  it("returns zero tax for exempt items", () => {
    expect(gstIncludedPaise(5_600, 0)).toBe(0);
  });

  it("totals a mixed cart in paise without floats", () => {
    const totals = cartTotals([
      { qty: 2, unitPricePaise: 2_800, gstRateBp: 0 }, // milk
      { qty: 1, unitPricePaise: 10_500, gstRateBp: 500 }, // dal
      { qty: 1, unitPricePaise: 14_000, gstRateBp: 1800 }, // detergent
    ]);
    expect(totals).toEqual({
      totalPaise: 30_100,
      taxPaise: 500 + 2_136,
      subtotalPaise: 30_100 - 2_636,
      itemCount: 4,
    });
  });
});
