export type CartQr = { cartCode: string; storeId: string };

const CART_CODE = /^C-\d{4,}$/;
const STORE_ID = /^S-\d{2,}$/;

/** Reads the QR printed on a cart: smartcart://pair?cart=C-0042&store=S-01 */
export function parseCartQr(raw: string): CartQr | null {
  const match = /^smartcart:\/\/pair\?(.*)$/.exec(raw.trim());
  if (!match) return null;
  const params = new Map(
    match[1]!.split("&").map((kv) => {
      const [k, v = ""] = kv.split("=");
      return [decodeURIComponent(k ?? ""), decodeURIComponent(v)] as const;
    }),
  );
  const cartCode = params.get("cart");
  const storeId = params.get("store");
  if (!cartCode || !storeId || !CART_CODE.test(cartCode) || !STORE_ID.test(storeId)) return null;
  return { cartCode, storeId };
}

/** Accepts a scanned QR, or a cart number typed by hand ("c-0042"). */
export function parseCartInput(raw: string, storeId: string): CartQr | null {
  const qr = parseCartQr(raw);
  if (qr) return qr;
  const code = raw.trim().toUpperCase();
  return CART_CODE.test(code) ? { cartCode: code, storeId } : null;
}
