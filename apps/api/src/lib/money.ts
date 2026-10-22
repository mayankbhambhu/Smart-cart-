/**
 * Indian retail prices are GST inclusive, so tax is extracted from the price rather than
 * added on top: tax = total * rate / (1 + rate). All amounts are integer paise.
 */
export function gstIncludedPaise(totalPaise: number, gstRateBp: number): number {
  if (gstRateBp === 0) return 0;
  return Math.round((totalPaise * gstRateBp) / (10_000 + gstRateBp));
}

export type PricedLine = { qty: number; unitPricePaise: number; gstRateBp: number };

export function lineAmounts(line: PricedLine) {
  const lineTotalPaise = line.qty * line.unitPricePaise;
  return { lineTotalPaise, lineTaxPaise: gstIncludedPaise(lineTotalPaise, line.gstRateBp) };
}

export function cartTotals(lines: PricedLine[]) {
  let totalPaise = 0;
  let taxPaise = 0;
  let itemCount = 0;
  for (const line of lines) {
    const a = lineAmounts(line);
    totalPaise += a.lineTotalPaise;
    taxPaise += a.lineTaxPaise;
    itemCount += line.qty;
  }
  return { totalPaise, taxPaise, subtotalPaise: totalPaise - taxPaise, itemCount };
}
