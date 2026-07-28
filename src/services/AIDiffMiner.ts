/**
 * Mine the draft-vs-sent gap for things worth remembering.
 *
 * On every reply the team sends, `linkActualReply` already pairs it with the AI's
 * draft and scores the overlap. That produced thousands of (guest asked, we
 * drafted this, a human actually sent that) triples — and the July audit found
 * nothing read them. It is the only learning signal the product generates in
 * volume without asking anyone to do extra work.
 *
 * A low-overlap pair is not automatically a lesson, though. Most of the gap is
 * paraphrase, pleasantries, or answers that are true only for one stay. This
 * module decides which pairs carry a durable, general fact, and shapes them into
 * review candidates. Candidates are proposals: they land as `pending` so a human
 * still approves before anything reaches a guest.
 *
 * Pure functions only — exercised by src/scripts/evalDiffMiner.ts with no DB.
 */
import { tokenize } from "./AIMemoryPolicy";

export type ReplyPair = {
    suggestionId: number;
    listingId: number | null;
    guestQuestion: string;
    aiDraft: string;
    teamReply: string;
    /** Jaccard token overlap 0–100, as stored on ai_message_suggestions. */
    similarity: number | null;
};

export type Candidate = {
    suggestionId: number;
    listingId: number | null;
    topic: string;
    question: string;
    answer: string;
};

/**
 * Flat rather than a discriminated union: this project compiles with `strict`
 * off, where narrowing on a boolean literal does not work.
 */
export type Verdict = {
    teachable: boolean;
    /** Set when `teachable`. */
    candidate?: Candidate;
    /** Set when not `teachable` — why the pair was dropped. */
    reason?: string;
};

/** Replies that carry no information — politeness, or a promise to follow up. */
const NO_CONTENT =
    /^(?:(?:you(?:['’]re| are) (?:very )?welcome|thank(?:s|\s+you)?(?:\s+(?:so|very)\s+much|\s+a\s+lot|\s+again)?|no problem|my pleasure|happy to help|sounds good|perfect|great|ok(?:ay)?|got it|sure|of course)[!.,\s]*)+$/i;
const DEFERRAL =
    /\b(?:i'?ll (?:check|look into|find out|confirm|get back)|let me (?:check|look|confirm)|we'?ll (?:check|confirm|get back)|getting this to|reaching out to)\b/i;

/**
 * Markers that an answer is true for this stay only. Teaching these as general
 * facts is how a bot ends up giving one guest another guest's door code or a
 * stale date.
 */
const STAY_SPECIFIC = [
    /\b\d{4,8}#?\b/, // access codes, confirmation numbers
    /\b\d{4}-\d{2}-\d{2}\b/, // ISO dates
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i,
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/, // 7/19
    /\byour (?:reservation|booking|stay|confirmation)\b/i,
];

/** A guest turn we can form a reusable question from. */
function looksLikeQuestion(text: string): boolean {
    const t = String(text || "").trim();
    if (!t) return false;
    if (t.includes("?")) return true;
    return /\b(?:can|could|do|does|is|are|what|when|where|how|which|any|would|will|may)\b/i.test(t);
}

/**
 * Short kebab topic from the question's content words, matching the style the
 * nightly extractor already produces ("check-in-time", "parking").
 */
export function deriveTopic(question: string): string {
    const tokens = tokenize(question).slice(0, 3);
    return tokens.length ? tokens.join("-").slice(0, 120) : "general";
}

export function classifyPair(pair: ReplyPair, opts: { maxSimilarity?: number } = {}): Verdict {
    const maxSimilarity = opts.maxSimilarity ?? 40;

    const question = String(pair.guestQuestion || "").replace(/\s+/g, " ").trim();
    const answer = String(pair.teamReply || "").replace(/\s+/g, " ").trim();

    // A close pair means the draft was already right — nothing to learn.
    if (pair.similarity != null && pair.similarity > maxSimilarity) {
        return { teachable: false, reason: "draft_already_close" };
    }
    if (!question) return { teachable: false, reason: "no_guest_question" };
    if (!looksLikeQuestion(question)) return { teachable: false, reason: "guest_turn_not_a_question" };
    // Contentless before short: a long string of thank-yous still teaches nothing,
    // and the reason is more useful than "too short" when triaging the tally.
    if (NO_CONTENT.test(answer)) return { teachable: false, reason: "team_reply_is_pleasantry" };
    if (DEFERRAL.test(answer)) return { teachable: false, reason: "team_reply_defers" };
    if (answer.length < 40) return { teachable: false, reason: "team_reply_too_short" };
    for (const re of STAY_SPECIFIC) {
        if (re.test(answer)) return { teachable: false, reason: "answer_not_generalizable" };
    }

    return {
        teachable: true,
        candidate: {
            suggestionId: pair.suggestionId,
            listingId: pair.listingId,
            topic: deriveTopic(question),
            question: question.slice(0, 500),
            answer: answer.slice(0, 2000),
        },
    };
}

/**
 * Collapse candidates that teach the same thing. The same question recurs across
 * a property constantly, and one approved fact covers all of them; `occurrences`
 * carries the repetition forward so frequently-confirmed facts rank higher.
 */
export function dedupeCandidates(
    candidates: Candidate[]
): Array<Candidate & { occurrences: number }> {
    const byKey = new Map<string, Candidate & { occurrences: number }>();
    for (const c of candidates) {
        const key = `${c.listingId ?? "portfolio"}|${c.topic}`;
        const hit = byKey.get(key);
        if (hit) {
            hit.occurrences += 1;
            // Keep the fullest answer — the team's longer reply usually explains more.
            if (c.answer.length > hit.answer.length) hit.answer = c.answer;
            continue;
        }
        byKey.set(key, { ...c, occurrences: 1 });
    }
    return [...byKey.values()].sort((a, b) => b.occurrences - a.occurrences);
}

/** Split a batch of pairs into review candidates and a tally of why the rest were dropped. */
export function minePairs(
    pairs: ReplyPair[],
    opts: { maxSimilarity?: number } = {}
): { candidates: Array<Candidate & { occurrences: number }>; rejected: Record<string, number> } {
    const kept: Candidate[] = [];
    const rejected: Record<string, number> = {};
    for (const p of pairs) {
        const v = classifyPair(p, opts);
        if (v.teachable && v.candidate) kept.push(v.candidate);
        else if (v.reason) rejected[v.reason] = (rejected[v.reason] || 0) + 1;
    }
    return { candidates: dedupeCandidates(kept), rejected };
}
