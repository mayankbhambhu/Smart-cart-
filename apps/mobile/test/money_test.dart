import 'package:flutter_test/flutter_test.dart';
import 'package:smart_cart/core/money.dart';

void main() {
  test('formats paise with Indian digit grouping', () {
    expect(formatInr(0), '₹0.00');
    expect(formatInr(2600), '₹26.00');
    expect(formatInr(123456), '₹1,234.56');
    expect(formatInr(1234567890), '₹1,23,45,678.90');
  });
}
