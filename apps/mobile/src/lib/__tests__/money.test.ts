import { formatInr, formatRate } from "../money";

test("formats paise with Indian digit grouping", () => {
  expect(formatInr(0)).toBe("₹0.00");
  expect(formatInr(2600)).toBe("₹26.00");
  expect(formatInr(123456)).toBe("₹1,234.56");
  expect(formatInr(1234567890)).toBe("₹1,23,45,678.90");
  expect(formatInr(-500)).toBe("-₹5.00");
});

test("formats GST rates from basis points", () => {
  expect(formatRate(500)).toBe("5%");
  expect(formatRate(1800)).toBe("18%");
});
