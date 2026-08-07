import {
  computeUpsellAmountToPayout,
  extractPmFeePercentFromTags,
  parsePmFeePercent,
} from "./upsellPayoutFee.util";

describe("upsellPayoutFee.util", () => {
  test("extracts PM% from listing tags", () => {
    expect(extractPmFeePercentFromTags("PM, 15%, Luxury")).toBe(15);
    expect(extractPmFeePercentFromTags("own,arb")).toBeNull();
    expect(parsePmFeePercent("25%")).toBe(25);
  });

  test("deducts 3% then PM fee", () => {
    // 100 → 97 after 3% → 82.45 after 15% PM → ceil cents = 82.45
    expect(computeUpsellAmountToPayout(100, 15)).toBe(82.45);
    // 200 → 194 → 174.6 at 10%
    expect(computeUpsellAmountToPayout(200, 10)).toBe(174.6);
  });

  test("zero/missing PM only applies processing fee", () => {
    expect(computeUpsellAmountToPayout(100, null)).toBe(97);
    expect(computeUpsellAmountToPayout(100, 0)).toBe(97);
  });
});
