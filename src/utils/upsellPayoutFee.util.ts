/**
 * Upsell payout fee formula (owner/net):
 *   1) Deduct 3% processing from the charged guest amount
 *   2) Deduct PM fee % for the property (from listing tag containing "%")
 *
 * amountToPayout = amount × (1 − 0.03) × (1 − pmFraction)
 */
export const UPSELL_PROCESSING_FEE_RATE = 0.03;

export function parsePmFeePercent(tagOrPercent: string | number | null | undefined): number | null {
  if (tagOrPercent == null || tagOrPercent === "") return null;
  if (typeof tagOrPercent === "number") {
    if (!Number.isFinite(tagOrPercent) || tagOrPercent < 0) return null;
    // Accept either 15 or 0.15; values > 1 are treated as percent points.
    return tagOrPercent > 1 ? tagOrPercent : tagOrPercent * 100;
  }
  const match = String(tagOrPercent).match(/(\d+(?:\.\d+)?)\s*%?/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function extractPmFeePercentFromTags(tags: string | null | undefined): number | null {
  const tag = String(tags || "")
    .split(",")
    .map((t) => t.trim())
    .find((t) => t.includes("%"));
  return parsePmFeePercent(tag || null);
}

export function computeUpsellAmountToPayout(
  amount: number,
  pmFeePercent: number | null | undefined,
  processingRate: number = UPSELL_PROCESSING_FEE_RATE
): number {
  const gross = Number(amount) || 0;
  if (!(gross > 0)) return 0;
  const afterProcessing = gross * (1 - processingRate);
  const pm = Number(pmFeePercent);
  const pmFraction =
    Number.isFinite(pm) && pm > 0 ? Math.min(pm, 100) / 100 : 0;
  const net = afterProcessing * (1 - pmFraction);
  // Keep cents precision; ceil to match existing extras netting behavior.
  return Math.ceil(net * 100) / 100;
}
