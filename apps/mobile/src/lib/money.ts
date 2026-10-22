/**
 * Formats integer paise as Indian rupees with Indian digit grouping: 123456789 -> "₹12,34,567.89".
 * The server computes every amount; the app only formats what it receives.
 */
export function formatInr(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100).toString();
  const fraction = (abs % 100).toString().padStart(2, "0");
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${negative ? "-" : ""}₹${grouped}.${fraction}`;
}

/** 500 basis points -> "5%". */
export const formatRate = (bp: number) => `${bp / 100}%`;
