import { budgetState, parseListText, parseRupees, unitPriceLabel, whereLabel } from "../assist-logic";

describe("smart list text", () => {
  it("splits lines and commas and drops bullets and numbering", () => {
    expect(parseListText("- milk\n2) atta, sugar\n\n• haldi  ")).toEqual(["milk", "atta", "sugar", "haldi"]);
  });
});

describe("budget", () => {
  it("parses rupee amounts", () => {
    expect(parseRupees("₹2,000")).toBe(200000);
    expect(parseRupees("150.5")).toBe(15050);
    expect(parseRupees("abc")).toBeNull();
    expect(parseRupees("0")).toBeNull();
  });

  it("tracks what is left and flags going over", () => {
    expect(budgetState(50000, 200000)).toEqual({
      budgetPaise: 200000,
      spentPaise: 50000,
      leftPaise: 150000,
      ratio: 0.25,
      over: false,
    });
    expect(budgetState(250000, 200000)).toMatchObject({ leftPaise: -50000, ratio: 1, over: true });
  });
});

describe("labels", () => {
  it("shows price per unit only when the pack size is known", () => {
    expect(unitPriceLabel({ unitPricePaise: 5200, unit: "L" })).toBe("₹52.00 / L");
    expect(unitPriceLabel({ unitPricePaise: null, unit: null })).toBeNull();
  });

  it("never invents a location", () => {
    expect(whereLabel({ aisle: "A1", shelf: "2" })).toBe("Aisle A1 · Shelf 2");
    expect(whereLabel({ aisle: null, shelf: null })).toBe("Location not mapped");
  });
});
