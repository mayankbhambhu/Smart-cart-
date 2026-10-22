"""Money is integer paise; GST rates are basis points (18% = 1800).

Indian shelf prices are GST inclusive, so tax is extracted from the price rather than added on
top: tax = total * rate / (1 + rate).
"""

from dataclasses import dataclass


def gst_included_paise(total_paise: int, gst_rate_bp: int) -> int:
    if gst_rate_bp == 0:
        return 0
    # Round half up, the same as the original TypeScript implementation (Math.round).
    num = total_paise * gst_rate_bp
    den = 10_000 + gst_rate_bp
    return (2 * num + den) // (2 * den)


@dataclass(frozen=True)
class PricedLine:
    qty: int
    unit_price_paise: int
    gst_rate_bp: int


def line_amounts(line: PricedLine) -> tuple[int, int]:
    """(line total, GST contained in it)."""
    total = line.qty * line.unit_price_paise
    return total, gst_included_paise(total, line.gst_rate_bp)


@dataclass(frozen=True)
class Totals:
    total_paise: int
    tax_paise: int
    subtotal_paise: int
    item_count: int


def cart_totals(lines: list[PricedLine]) -> Totals:
    total = tax = items = 0
    for line in lines:
        t, x = line_amounts(line)
        total += t
        tax += x
        items += line.qty
    return Totals(total_paise=total, tax_paise=tax, subtotal_paise=total - tax, item_count=items)
