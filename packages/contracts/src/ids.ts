import { z } from "zod";

/** Store codes look like S-01. */
export const StoreId = z.string().regex(/^S-\d{2,}$/);
/** Physical cart codes printed on the cart QR, e.g. C-0042. */
export const CartCode = z.string().regex(/^C-\d{4,}$/);
/** EAN-13 barcode, digits only. Check digit is validated by isValidEan13. */
export const Ean13 = z.string().regex(/^\d{13}$/);
/** Money is always integer paise. Never floats. */
export const Paise = z.number().int().nonnegative();
/** GST rate in basis points: 18% = 1800. */
export const BasisPoints = z.number().int().min(0).max(10_000);

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(first12[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}
