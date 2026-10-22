import { describe, expect, it } from "vitest";
import { DemoApiError } from "./errors.js";
import { ShopperDemo } from "./shopper.js";
import { DEMO_LOGINS, pickupSlots } from "./team.js";

const shopper = "dev:u1:Priya";
const [FLOOR, MANAGER, ADMIN] = DEMO_LOGINS;

async function signIn(api: ShopperDemo, login: string, password: string) {
  const res = (await api.request("POST", "/v1/auth/staff/login", { login, password }, null)) as { token: string; mustChangePassword: boolean };
  return res;
}

describe("store-team demo", () => {
  it("offers pickup slots only in store hours", () => {
    const lateEvening = Date.parse("2026-10-22T16:10:00Z"); // 21:40 IST
    expect(pickupSlots(lateEvening, 2).map((s) => s.label)).toEqual(["Fri 08:00–08:30", "Fri 08:30–09:00"]);
  });

  it("decides the side from the account, not the login tab", async () => {
    const api = new ShopperDemo();
    const { token } = await signIn(api, FLOOR.login, FLOOR.password);
    expect(await api.request("GET", "/v1/me", undefined, token)).toMatchObject({ side: "store", role: "floor_staff" });
    expect(await api.request("GET", "/v1/me", undefined, shopper)).toMatchObject({ side: "shopper" });
    await expect(api.request("GET", "/admin/v1/stores/S-01/staff", undefined, token)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("locks an account after five wrong passwords", async () => {
    const api = new ShopperDemo();
    for (let i = 0; i < 5; i++) {
      await expect(signIn(api, FLOOR.login, "wrong-one")).rejects.toMatchObject({ code: "invalid_credentials" });
    }
    await expect(signIn(api, FLOOR.login, FLOOR.password)).rejects.toMatchObject({ status: 423 });
  });

  it("creates a staff account only after the admin team approves it", async () => {
    const api = new ShopperDemo();
    const manager = (await signIn(api, MANAGER.login, MANAGER.password)).token;
    const admin = (await signIn(api, ADMIN.login, ADMIN.password)).token;
    const req = (await api.request(
      "POST",
      "/admin/v1/stores/S-01/staff-requests",
      { fullName: "Asha Pawar", phone: "98200 12345", role: "floor_staff", shift: "Morning" },
      manager,
    )) as { id: string; phone: string };
    expect(req.phone).toBe("+919820012345");
    const approved = (await api.request("POST", `/admin/v1/staff-requests/${req.id}/review`, { action: "approve" }, admin)) as {
      staff: { staffCode: string };
      sms: { devMessage: string };
    };
    const temp = approved.sms.devMessage.split("Temporary password ")[1]!.split(",")[0]!;
    const first = await signIn(api, "+91 98200 12345", temp);
    expect(first.mustChangePassword).toBe(true);
    await expect(api.request("GET", "/staff/v1/stores/S-01/tasks", undefined, first.token)).rejects.toMatchObject({
      code: "password_change_required",
    });
    await api.request("POST", "/v1/auth/staff/password", { currentPassword: temp, newPassword: "new-pass-123" }, first.token);
    const tasks = (await api.request("GET", "/staff/v1/stores/S-01/tasks", undefined, first.token)) as { tasks: unknown[] };
    expect(tasks.tasks.length).toBeGreaterThan(0);
  });

  it("holds a reservation, picks it into a parked cart and collects it", async () => {
    const api = new ShopperDemo();
    const floor = (await signIn(api, FLOOR.login, FLOOR.password)).token;
    const { slots } = (await api.request("GET", "/v1/stores/S-01/reservations/slots", undefined, shopper)) as { slots: { start: string }[] };
    const res = (await api.request(
      "POST",
      "/v1/stores/S-01/reservations",
      { items: [{ productId: "demo-1", qty: 2 }], slotStart: slots[0]!.start },
      shopper,
    )) as { id: string; status: string };
    expect(res.status).toBe("reserved");
    await expect(api.request("POST", "/v1/carts/pair", { cartCode: "C-0018" }, shopper)).rejects.toMatchObject({ code: "cart_reserved" });
    const picked = (await api.request("POST", `/staff/v1/stores/S-01/reservations/${res.id}/picked`, { cartCode: "c-0017" }, floor)) as {
      status: string;
      pickedBy: string;
    };
    expect(picked).toMatchObject({ status: "picked", pickedBy: FLOOR.name });
    const collected = (await api.request("POST", `/v1/stores/S-01/reservations/${res.id}/collect`, {}, shopper)) as {
      cart: { cartCode: string; totals: { itemCount: number } };
    };
    expect(collected.cart).toMatchObject({ cartCode: "C-0017", totals: { itemCount: 2 } });
  });

  it("refuses to reserve more than is on the shelf", async () => {
    const api = new ShopperDemo();
    const { slots } = (await api.request("GET", "/v1/stores/S-01/reservations/slots", undefined, shopper)) as { slots: { start: string }[] };
    const low = "demo-30"; // Daawat Basmati Rice 1 kg: 3 on hand
    await expect(
      api.request("POST", "/v1/stores/S-01/reservations", { items: [{ productId: low, qty: 4 }], slotStart: slots[0]!.start }, shopper),
    ).rejects.toBeInstanceOf(DemoApiError);
  });
});
