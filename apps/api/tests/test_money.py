from smartcart.money import PricedLine, Totals, cart_totals, gst_included_paise


def test_extracts_18_percent_gst_from_an_inclusive_price() -> None:
    # Rs 118.00 at 18% contains Rs 18.00 of tax.
    assert gst_included_paise(11_800, 1800) == 1800


def test_exempt_items_have_no_tax() -> None:
    assert gst_included_paise(5_600, 0) == 0


def test_totals_a_mixed_cart_in_paise_without_floats() -> None:
    totals = cart_totals(
        [
            PricedLine(qty=2, unit_price_paise=2_800, gst_rate_bp=0),  # milk
            PricedLine(qty=1, unit_price_paise=10_500, gst_rate_bp=500),  # dal
            PricedLine(qty=1, unit_price_paise=14_000, gst_rate_bp=1800),  # detergent
        ]
    )
    assert totals == Totals(
        total_paise=30_100, tax_paise=500 + 2_136, subtotal_paise=30_100 - 2_636, item_count=4
    )
