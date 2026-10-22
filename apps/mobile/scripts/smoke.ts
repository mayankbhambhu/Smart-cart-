/**
 * Smoke test: drives the app's own API client and realtime code (no UI) against a running API
 * with AUTH_MODE=dev and the demo seed:
 *   EXPO_PUBLIC_API_URL=http://localhost:4000 pnpm --filter @smart-cart/mobile smoke
 */
import type { SmartCartEvent } from "@smart-cart/contracts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { api, setAuthToken } from "../src/lib/api";
import { connectCart } from "../src/lib/realtime";

async function waitFor(check: () => boolean, what: string, ms = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function main() {
  const token = `dev:smoke-${randomUUID().slice(0, 8)}:Smoke Test`;
  setAuthToken(token);

  const stores = await api.stores();
  assert.equal(stores[0]?.id, "S-01");

  let paired = null;
  for (let n = 1; n <= 20 && !paired; n++) {
    paired = await api.pair(`C-${String(n).padStart(4, "0")}`, "S-01").catch(() => null);
  }
  assert.ok(paired, "no free cart among C-0001..C-0020");
  const { sessionId, cartCode } = paired;
  console.log(`paired ${cartCode}`);

  const events: SmartCartEvent[] = [];
  let live = false;
  let paidOrderId = "";
  const close = connectCart({ token, sessionId, onEvent: (e) => events.push(e), onLive: (l) => (live = l) });
  try {
    await waitFor(() => live && events.some((e) => e.type === "cart.snapshot"), "snapshot on join");
    console.log("joined cart room, got snapshot");

    const preview = await api.product("2000000000015", "S-01");
    assert.equal(preview?.name, "Amul Toned Milk 500 ml");
    assert.equal(await api.product("2999999999999", "S-01"), null);

    const requestId = randomUUID();
    const change = await api.addItem(sessionId, "2000000000015", 2, requestId);
    assert.equal(change.line?.qty, 2);
    const retry = await api.addItem(sessionId, "2000000000015", 2, requestId);
    assert.equal(retry.line?.qty, 2, "a retried add must not double");
    await waitFor(() => events.some((e) => e.type === "cart.item_added"), "item_added pushed");
    console.log(`added 2 x ${preview?.name}, total ${change.totals.totalPaise} paise, pushed live`);

    const removed = await api.removeItem(sessionId, change.line!.productId, 1, randomUUID());
    assert.equal(removed.line?.qty, 1);
    await waitFor(() => events.some((e) => e.type === "cart.item_removed"), "item_removed pushed");
    console.log("removed one, pushed live");

    const { order, payment } = await api.checkout(sessionId);
    assert.equal(order.status, "pending_payment");
    await waitFor(() => events.some((e) => e.type === "cart.checked_out"), "checked_out pushed");
    await api.backToCart(order.orderId);
    await api.addItem(sessionId, "2000000000015", 1, randomUUID());
    const again = await api.checkout(sessionId);
    assert.equal(again.order.orderId, order.orderId);
    assert.equal(again.order.totals.itemCount, 2);
    console.log(`checked out, went back to add one, checked out again: ${again.order.totals.totalPaise} paise`);

    if (payment.provider !== "fake") throw new Error("the smoke test needs the API's fake payment provider");
    const receipt = await api.payFake(order.orderId);
    assert.equal(receipt.status, "paid");
    assert.match(receipt.exitCode ?? "", /^[2-9A-Z]{6}$/);
    await waitFor(() => events.some((e) => e.type === "order.paid"), "order.paid pushed");
    paidOrderId = order.orderId;
    console.log(`paid; exit code ${receipt.exitCode}`);
  } finally {
    close();
  }

  assert.equal(await api.myCart(), null);
  assert.ok((await api.myOrders()).some((o) => o.orderId === paidOrderId), "receipt listed");
  console.log("cart freed and receipt listed; smoke test passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
