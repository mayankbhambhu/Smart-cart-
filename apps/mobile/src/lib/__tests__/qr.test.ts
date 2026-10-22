import { parseCartInput, parseCartQr } from "../qr";

test("reads cart and store from the cart QR", () => {
  expect(parseCartQr("smartcart://pair?cart=C-0042&store=S-01")).toEqual({ cartCode: "C-0042", storeId: "S-01" });
});

test("rejects other QR codes", () => {
  expect(parseCartQr("https://example.com/?cart=C-0042&store=S-01")).toBeNull();
  expect(parseCartQr("smartcart://pair?cart=42&store=S-01")).toBeNull();
  expect(parseCartQr("8901234567890")).toBeNull();
});

test("accepts a cart number typed by hand", () => {
  expect(parseCartInput(" c-0007 ", "S-01")).toEqual({ cartCode: "C-0007", storeId: "S-01" });
  expect(parseCartInput("hello", "S-01")).toBeNull();
});
