import { describe, expect, it } from "vitest";
import { DemoApiError, ShopperDemo } from "./shopper.js";

const token = "dev:u1:Priya";

describe("shopper app demo backend", () => {
  it("pairs, scans, checks out, pays and lists the receipt", async () => {
    const api = new ShopperDemo();
    const cart = (await api.request("POST", "/v1/carts/pair", { cartCode: "c-0003", storeId: "S-01" }, token)) as {
      sessionId: string;
    };
    const events: string[] = [];
    api.connect(cart.sessionId, (e) => events.push(e.type), () => {});
    const add = (requestId: string) =>
      api.request("POST", `/v1/carts/${cart.sessionId}/items`, { barcode: "2000000000015", qty: 2, requestId }, token);
    await add("r1");
    const again = (await add("r1")) as { totals: { itemCount: number } };
    expect(again.totals.itemCount).toBe(2); // a retried scan counts once

    const { order } = (await api.request("POST", `/v1/carts/${cart.sessionId}/checkout`, {}, token)) as {
      order: { orderId: string; totals: { totalPaise: number } };
    };
    expect(order.totals.totalPaise).toBe(5200);
    const receipt = (await api.request("POST", `/v1/orders/${order.orderId}/pay/fake`, {}, token)) as { exitCode: string };
    expect(receipt.exitCode).toMatch(/^[2-9A-Z]{6}$/);
    expect(events).toEqual(expect.arrayContaining(["cart.item_added", "cart.checked_out", "order.paid", "cart.session_ended"]));
    expect(await api.request("GET", "/v1/me/cart", undefined, token)).toEqual({ session: null });
    const mine = (await api.request("GET", "/v1/me/orders", undefined, token)) as { orders: unknown[] };
    expect(mine.orders).toHaveLength(1);
  });

  it("calls for help from the aisle of the last scan", async () => {
    const api = new ShopperDemo();
    const cart = (await api.request("POST", "/v1/carts/pair", { cartCode: "C-0004" }, token)) as { sessionId: string };
    await api.request("POST", `/v1/carts/${cart.sessionId}/items`, { barcode: "2000000000015", qty: 1, requestId: "a" }, token);
    const help = (await api.request("POST", "/v1/stores/S-01/help", { topic: "stock" }, token)) as { aisle: string; status: string };
    expect(help).toMatchObject({ aisle: "A1", status: "open" });
  });

  it("refuses requests without sign-in, like the API", async () => {
    await expect(new ShopperDemo().request("GET", "/v1/me/cart", undefined, null)).rejects.toBeInstanceOf(DemoApiError);
  });
});
