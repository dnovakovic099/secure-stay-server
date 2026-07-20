/**
 * Guards for portfolio-wide AI memory (learned facts + proven-reply FAQ).
 *
 * Portfolio answers must stay generic (ops process, tone). Anything that names
 * a checkout time, capacity, deposit, amenity, address, or a specific channel
 * policy must not be retrieved for unrelated bookings — that was a top
 * wrong_info source (e.g. "checkout is 10am" / "no Airbnb deposit" on Vrbo).
 */

/** Facts/answers that belong to one property (or one channel) — never portfolio. */
export const PROPERTY_SCOPED_MEMORY =
    /\b(garage|driveway|carport|parking|door\s*code|lock\s*code|gate\s*code|access\s*code|wifi\s*password|\bpassword\b|\baddress\b|\bfloor\b|square\s*feet|sq\s*ft|bedroom|bathroom|\bsleeps?\b|max(imum)?\s*(occupancy|guests?)|person\s*capacity|pool\s*heat|first\s*aid|security\s*deposit|\bdeposit\b|amenit(y|ies)?|\bwedding\b)\b|check-?\s*out\s+(is|at|by)|check-?\s*in\s+(is|at|from)/i;

/** Absolute clock times often used for check-in/out — portfolio must not assert these. */
const ABSOLUTE_TIME =
    /\b(?:at|by|from|is)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i;

const CHANNEL_MENTION = /\b(airbnb|vrbo|homeaway|booking\.com|hvmb)\b/i;

export function isPropertyScopedMemory(text: string): boolean {
    const t = String(text || "");
    if (!t.trim()) return false;
    return PROPERTY_SCOPED_MEMORY.test(t) || ABSOLUTE_TIME.test(t);
}

/**
 * True when the text asserts a channel-specific rule that does not match the
 * guest's booking channel (e.g. Airbnb deposit policy on a Vrbo thread).
 */
export function portfolioChannelMismatch(text: string, channel?: string | null): boolean {
    const t = String(text || "").toLowerCase();
    if (!CHANNEL_MENTION.test(t)) return false;
    const ch = String(channel || "").toLowerCase();
    const mentionsAirbnb = /\bairbnb\b/.test(t);
    const mentionsVrbo = /\b(vrbo|homeaway)\b/.test(t);
    const mentionsBooking = /\bbooking\.com\b/.test(t);
    const mentionsHvmb = /\bhvmb\b/.test(t);
    if (mentionsAirbnb && !ch.includes("airbnb")) return true;
    if (mentionsVrbo && !(ch.includes("vrbo") || ch.includes("homeaway"))) return true;
    if (mentionsBooking && !ch.includes("booking")) return true;
    if (mentionsHvmb && !ch.includes("hvmb") && !ch.includes("airbnb")) return true;
    return false;
}

/** Drop portfolio rows that would contaminate this booking. */
export function allowPortfolioMemory(text: string, channel?: string | null): boolean {
    if (isPropertyScopedMemory(text)) return false;
    if (portfolioChannelMismatch(text, channel)) return false;
    return true;
}
