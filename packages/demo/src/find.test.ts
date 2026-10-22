import { describe, expect, it } from "vitest";
import { catalog } from "./catalog.js";
import { packSize, queryWords, retrieve, routeList, rulesAnswer, search } from "./find.js";

const find = (q: string) => search(catalog, () => 30, q);

describe("demo find-it-fast matches the API's rules", () => {
  it("understands Hindi words and drops quantities", () => {
    expect(queryWords("2 kg Haldi")).toEqual(["turmeric"]);
    expect(packSize("Lux Bathing Soap 100 g x 4")).toEqual([0.4, "kg"]);
  });

  it("orders search results by price per kg", () => {
    const haldi = find("haldi");
    expect(haldi.length).toBeGreaterThan(0);
    const perKg = haldi.map((r) => r.unitPricePaise!);
    expect(perKg).toEqual([...perKg].sort((a, b) => a - b));
  });

  it("filters by diet", () => {
    expect(search(catalog, () => 30, "chips", ["jain"])).toEqual([]);
  });

  it("routes a list front to back and keeps unknown lines", () => {
    const route = routeList(find, ["shampoo", "doodh", "atta", "dragonfruit"]);
    expect(route.stops.map((s) => s.aisle)).toEqual(["A1", "B1", "D1"]);
    expect(route.notFound).toEqual(["dragonfruit"]);
  });

  it("picks the pack size a list line names", () => {
    const items = routeList(find, ["toor dal 1 kg", "toor dal"]).stops.flatMap((s) => s.items);
    const pick = (line: string) => items.find((i) => i.line === line)!.product.name;
    expect(pick("toor dal 1 kg")).toBe("Tata Sampann Toor Dal 1 kg");
    expect(pick("toor dal")).not.toContain(" 1 kg");
  });

  it("answers from store facts or says it is not sure", () => {
    const paneer = retrieve(find, "paneer kahan milega?");
    expect(paneer.every((p) => p.name.includes("Paneer"))).toBe(true);
    expect(rulesAnswer([])).toContain("won't guess");
  });
});

describe("browse by section", () => {
  it("lists a section in shelf order and filters by food label", async () => {
    const { browse } = await import("./find.js");
    const { catalog } = await import("./catalog.js");
    const { sections } = await import("./sections.js");
    const dairy = browse(catalog, () => 50, { section: "dairy-eggs" }, sections);
    expect(dairy[0]!.category).toBe("Milk");
    expect(dairy.at(-1)!.foodType).toBe("egg");
    const vegOnly = browse(catalog, () => 50, { section: "dairy-eggs", tags: ["veg"] }, sections);
    expect(vegOnly.some((p) => p.foodType === "egg")).toBe(false);
    const meat = browse(catalog, () => 50, { section: "meat-fish" }, sections);
    expect(meat.length).toBeGreaterThan(0);
    expect(meat.every((p) => p.foodType === "non_veg")).toBe(true);
  });
});
