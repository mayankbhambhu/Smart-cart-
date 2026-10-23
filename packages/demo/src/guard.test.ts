import type { SmartCartEvent } from "@smart-cart/contracts";
import { describe, expect, it } from "vitest";
import { catalog } from "./catalog.js";
import { DemoApiError } from "./errors.js";
import { Guard, weightCheck, type GuardSession } from "./guard.js";
import { ShopperDemo } from "./shopper.js";
import { DEMO_LOGINS } from "./team.js";

const milk = catalog.find((p) => p.name === "Amul Toned Milk 500 ml")!;

function setup() {
  const events: SmartCartEvent[] = [];
  const sessions = new Map<string, GuardSession>();
  const guard = new Guard({
    storeId: "S-01",
    emit: (e) => events.push(e),
    sessionFor: (code) => sessions.get(code) ?? null,
    weighs: () => true,
    alertAfterMs: 0,
  });
  const shop = (code: string, qty = 2) =>
    sessions.set(code, { sessionId: `s-${code}`, cartCode: code, shopperName: "Asha", startedAt: new Date().toISOString(), lines: [[milk.productId, qty]], lastAisle: "A1" });
  return { guard, events, sessions, shop };
}

describe("weight check", () => {
  it("allows scale drift, and never guesses without weights", () => {
    expect(weightCheck(1090, [[515, 2]]).status).toBe("ok");
    expect(weightCheck(1480, [[515, 2]])).toEqual({ status: "extra", expectedG: 1030, diffG: 450 });
    expect(weightCheck(515, [[515, 2]]).status).toBe("missing");
    expect(weightCheck(5000, [[515, 1], [null, 1]]).status).toBe("unknown");
  });
});

describe("the demo cart guard", () => {
  it("nudges the shopper, alerts staff, then clears once the item is scanned", () => {
    const { guard, events, shop } = setup();
    shop("C-0003");
    guard.sense("C-0003");
    expect(events).toHaveLength(0);
    guard.setUnscanned("C-0003", 450);
    guard.sense("C-0003");
    expect(events.map((e) => e.type)).toEqual(["cart.weight_check", "security.alert"]);
    const alert = guard.list()[0]!;
    expect(alert).toMatchObject({ kind: "unscanned_item", cartId: "C-0003", aisle: "A1", status: "open" });
    expect(guard.bagCheck("s-C-0003")?.reason).toMatch(/about (400|450|500) g more/);
    guard.setUnscanned("C-0003", 0);
    guard.sense("C-0003");
    expect(events.at(-1)).toMatchObject({ type: "security.updated", data: { status: "cleared" } });
    expect(guard.list()).toHaveLength(0);
  });

  it("lets staff resolve once, and alerts once per unpaid exit", () => {
    const { guard, shop } = setup();
    shop("C-0005");
    const first = guard.gatePass("C-0005", "G1");
    expect(guard.gatePass("C-0005", "G1").alertId).toBe(first.alertId);
    expect(guard.act(first.alertId!, "false_alarm", "Went back in", "Ravi").status).toBe("false_alarm");
    expect(() => guard.act(first.alertId!, "resolve", null, "Ravi")).toThrow(DemoApiError);
    expect(guard.gatePass("C-0009", "G1")).toEqual({ result: "ok", alertId: null });
  });

  it("shows 20 carts with faults and keeps busy carts in service", () => {
    const { guard, shop } = setup();
    shop("C-0002");
    const fleet = guard.fleet();
    expect(fleet).toHaveLength(20);
    expect(fleet.find((c) => c.cartId === "C-0017")!.faults).toContain("low_battery");
    expect(fleet.find((c) => c.cartId === "C-0020")!.faults).toContain("offline");
    expect(fleet.find((c) => c.cartId === "C-0002")).toMatchObject({ status: "in_use", shopperName: "Asha" });
    expect(() => guard.setStatus("C-0002", "maintenance", null)).toThrow(DemoApiError);
    expect(guard.setStatus("C-0010", "maintenance", "Wobbly wheel").status).toBe("maintenance");
    expect(guard.setStatus("C-0010", "available", null).status).toBe("available");
  });
});

describe("the app demo", () => {
  it("tells the shopper about an unscanned item and asks for a bag check at the exit", async () => {
    const app = new ShopperDemo();
    app.guard.alertAfterMs = 0;
    const token = "dev:u-guard:Kiran";
    const cart = (await app.request("POST", "/v1/carts/pair", { cartCode: "C-0012" }, token)) as { sessionId: string };
    await app.request("POST", `/v1/carts/${cart.sessionId}/items`, { barcode: milk.barcode, qty: 1, requestId: "r1" }, token);
    const seen: SmartCartEvent[] = [];
    app.connect(cart.sessionId, (e) => seen.push(e), () => {});
    app.guard.setUnscanned("C-0012", 450);
    app.guard.sense("C-0012");
    expect(seen.find((e) => e.type === "cart.weight_check")).toMatchObject({ data: { status: "extra" } });
    expect(app.unscannedIn(cart.sessionId)).toBe(true);
    app.guard.setMaintenance(["C-0014"]);
    await expect(app.request("POST", "/v1/carts/pair", { cartCode: "C-0014" }, "dev:u2:X")).rejects.toMatchObject({ code: "cart_in_maintenance" });

    const order = (await app.request("POST", `/v1/carts/${cart.sessionId}/checkout`, null, token)) as { order: { orderId: string } };
    const paid = (await app.request("POST", `/v1/orders/${order.order.orderId}/pay/fake`, null, token)) as { exitCode: string };
    const [floor] = DEMO_LOGINS;
    const { token: staff } = (await app.request("POST", "/v1/auth/staff/login", { login: floor.login, password: floor.password }, null)) as { token: string };
    const check = (await app.request("POST", "/staff/v1/stores/S-01/exit-checks", { code: paid.exitCode }, staff)) as {
      result: string;
      bagCheck: { reason: string } | null;
    };
    expect(check.result).toBe("ok");
    expect(check.bagCheck?.reason).toMatch(/Check the bag/);
    const alerts = (await app.request("GET", "/staff/v1/stores/S-01/security-alerts", null, staff)) as { alerts: { id: string }[] };
    expect(alerts.alerts).toHaveLength(1);
  });
});
