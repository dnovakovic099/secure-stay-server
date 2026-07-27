/**
 * Guest-facing reply formatting.
 *
 * Pure text helpers, kept out of InboxAIService so they can be exercised
 * directly by src/scripts/evalReplyFormat.ts with no database or model calls.
 */

/** Spans where a hyphen is load-bearing and must survive untouched. */
const PRESERVED_SPAN =
    /(?:https?:\/\/|www\.)[^\s]*[^\s.,;:!?)]|[\w.+-]+@[\w-]+\.[\w.-]+|\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b/g;

/**
 * House style forbids dashes in guest replies — they read as machine-written.
 * Sentence dashes become commas, compound hyphens become spaces.
 *
 * The rewrite used to run over the whole reply, which quietly destroyed every
 * link, address and code the bot sent: guests received "https://secure stay.com
 * /check in" and door codes like "4821 9930". Those spans are masked out of the
 * rewrite and restored verbatim afterwards.
 */
export function stripDashes(text: string): string {
    if (!text) return text;

    const preserved: string[] = [];
    const masked = text.replace(PRESERVED_SPAN, (match) => {
        const isLinkOrEmail = /^(?:https?:\/\/|www\.)/i.test(match) || match.includes("@");
        const alnum = match.replace(/[^A-Za-z0-9]/g, "");
        // Codes qualify on shape — a digit plus some length — so that ordinary
        // compounds like "check-in" still lose their hyphen as intended.
        if (!isLinkOrEmail && !(/\d/.test(alnum) && alnum.length >= 5)) return match;
        preserved.push(match);
        return `\uE000${preserved.length - 1}\uE001`;
    });

    // Sentence dashes (en/em dash, or a spaced hyphen) read as punctuation —
    // turn them into a comma so the sentence still flows ("out back — I've got
    // a kayak" → "out back, I've got a kayak"), instead of the bare space that
    // used to create run-ons.
    const commaFixed = masked
        .replace(/(\d)\s*[\u2012-\u2015\u2212]\s*(?=[A-Za-z0-9])/g, "$1 to ")
        .replace(/\s+-\s+/g, ", ")
        .replace(/\s*[\u2012-\u2015\u2212]\s*/g, ", ");
    // Remaining hyphen variants (compound words like check-in) become spaces.
    const noDash = commaFixed.replace(/[\u2010-\u2011\uFE58\uFE63\uFF0D-]/g, " ");

    return noDash
        .split("\n")
        .map((line) =>
            line
                .replace(/[ \t]{2,}/g, " ")
                .replace(/\s+([,.!?;:])/g, "$1")
                .replace(/^ +| +$/g, "")
        )
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .replace(/\uE000(\d+)\uE001/g, (_, i) => preserved[Number(i)] ?? "");
}
