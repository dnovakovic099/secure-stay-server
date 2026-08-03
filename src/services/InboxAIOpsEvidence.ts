/**
 * Ops-evidence gate for guest-facing replies.
 *
 * The July audit found the top remaining failure is the bot telling a guest an
 * operational request is already arranged, approved, or scheduled when the team
 * had only promised to check. The previous guard (`detectActionClaims`) matched
 * only first-person present-perfect phrasing ("I've approved") and cleared any
 * match whose bare verb appeared anywhere in the context — a typical context
 * already contains "confirmed", "applied" and "activated", so it caught nothing.
 *
 * The fix keys off evidence instead of phrasing, because phrasing cannot
 * separate the two cases:
 *
 *   "The team is already arranging two blow up beds"   (wrong — nothing started)
 *   "Our team is already checking if we can arrange"   (fine — that's a promise)
 *
 * Two signals resolve it deterministically:
 *
 *   1. If the guest's inbound turn contains a NEW request, then by definition
 *      nothing has happened yet — the message arrived seconds ago and ticket
 *      detection is debounced minutes behind the reply. Any completion, ops
 *      progress, or ETA claim is false regardless of wording.
 *   2. Otherwise the ops ledger is the authority: a [DONE] line permits stating
 *      completion, an [OPEN] line permits "the team is on it", and no line at
 *      all means nothing has been logged.
 *
 * Promising to do something is always safe and is what the team actually
 * writes; only claims about STATE are gated.
 */

/** Verbs describing work the ops team performs on the guest's behalf. */
const OPS_ACTION_STEMS = [
    "arrang", "deliver", "schedul", "set\\s+up", "coordinat", "prepar", "install",
    "drop(?:ped|ping)?\\s+off", "bring|brought", "order", "replac", "restock",
    "block(?:ed|ing)?\\s+off", "approv", "process", "refund", "waiv", "activat",
    "authoriz", "extend", "upgrad", "reserv", "book", "clean", "repair", "fix(?:ed|ing)?",
];

/**
 * Verbs that describe the agent looking into something rather than ops acting.
 * "Our team is checking" is a commitment, not a state claim, so it stays safe.
 */
const INQUIRY_STEMS = [
    "check", "look(?:ing)?\\s+into", "reach(?:ing)?\\s+out", "follow(?:ing)?\\s+up",
    "confirm", "see\\s+if", "find\\s+out", "ask", "get\\s+back", "review", "verif",
];

/**
 * Looking into something is safe as a promise but not as a finished act: "our
 * team has reviewed your request" asserts a decision was reached, which is the
 * same overreach as claiming delivery. Only the perfect form is gated.
 */
const DECISION_STEMS = ["review", "decid", "determin", "assess", "evaluat", "look(?:ed)?\\s+into"];

/** A clock time, with or without a meridiem: "6 PM", "12:30", "3 to 5". */
const CLOCK =
    "\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)|" +
    "\\d{1,2}(?::\\d{2})\\b|" +
    "\\d{1,2}\\s*(?:to|-|–|and)\\s*\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?";

const SUBJECT =
    "(?:i|we|our\\s+team|the\\s+team|my\\s+team|they|housekeeping|maintenance|" +
    "our\\s+(?:property\\s+)?managers?|the\\s+cleaners?)";

function anyOf(stems: string[]): string {
    return `(?:${stems.join("|")})`;
}

export type OpsClaim = {
    /** The offending phrase, for the staff-facing warning. */
    text: string;
    /**
     * completion — asserts the work is finished or approved.
     * progress   — asserts ops has started work.
     * eta        — attaches a specific time or window to ops work.
     */
    kind: "completion" | "progress" | "eta";
};

/**
 * True when the guest's inbound turn asks for something to be done, provided,
 * fixed, or approved. Deliberately broad: a false positive only means the reply
 * must promise instead of assert, which is the safe direction and matches how
 * the team writes.
 */
export function guestMakesNewRequest(text: string): boolean {
    const t = String(text || "").toLowerCase();
    if (!t.trim()) return false;

    // Direct asks.
    if (
        /\b(?:can|could|would|will)\s+(?:you|we|i|someone|somebody|the\s+team)\b/.test(t) ||
        /\b(?:is|are)\s+(?:it|there|we|you)\s+(?:possible|able|any\s+(?:way|chance))\b/.test(t) ||
        /\b(?:please|kindly)\s+\w+/.test(t) ||
        /\b(?:we|i)\s+(?:need|want|would\s+like|'d\s+like|require)\b/.test(t) ||
        /\b(?:any\s+chance|do\s+you\s+(?:have|offer|allow)|may\s+(?:i|we))\b/.test(t)
    ) {
        return true;
    }

    // Problem reports imply a request for ops to act.
    if (
        /\b(?:isn'?t|is\s+not|not)\s+working\b/.test(t) ||
        /\b(?:broken|leaking|clogged|out\s+of|ran\s+out|missing|dirty|no\s+hot\s+water|locked\s+out|can'?t\s+find)\b/.test(t)
    ) {
        return true;
    }

    return false;
}

/**
 * Claims about the STATE of operational work. Recall-tuned: every inflection of
 * the action verbs, first and third person, active and passive. The caller
 * decides which kinds are unsafe based on the ops evidence available.
 */
export function detectOpsStateClaims(reply: string): OpsClaim[] {
    const text = String(reply || "");
    if (!text.trim()) return [];

    const ops = anyOf(OPS_ACTION_STEMS);
    const inquiry = anyOf(INQUIRY_STEMS);
    const decision = anyOf(DECISION_STEMS);
    const found = new Map<string, OpsClaim>();

    // "I'll let you know the moment it's sorted" states a condition, not a fact.
    const HYPOTHETICAL = /\b(?:when|once|until|unless|if|after|the\s+moment|as\s+soon\s+as|hopefully|should)\s+[\w'’]*\s*$/i;
    const add = (m: string | undefined, kind: OpsClaim["kind"], at = -1) => {
        const t = (m || "").replace(/\s+/g, " ").trim();
        if (!t || found.has(t)) return;
        if (at >= 0 && HYPOTHETICAL.test(text.slice(Math.max(0, at - 30), at))) return;
        found.set(t, { text: t.slice(0, 120), kind });
    };
    const scan = (re: RegExp, kind: OpsClaim["kind"]) => {
        for (const m of text.matchAll(re)) add(m[0], kind, m.index ?? -1);
    };

    // --- completion: perfect, passive, or stative "it is done" ---
    const completionPatterns: RegExp[] = [
        // "we've arranged", "our team has already approved", "I have blocked off"
        new RegExp(
            `\\b${SUBJECT}\\s*(?:['’]ve|['’]s|\\s+ha(?:s|ve|d))\\s+(?:already\\s+|just\\s+|gone\\s+ahead\\s+and\\s+)?(?:${ops}|${decision})\\w*`,
            "gi"
        ),
        // "has been delivered", "was approved", "'s been taken care of"
        new RegExp(`\\b(?:ha(?:s|ve|d)\\s+been|was|were|is|are)\\s+(?:already\\s+|now\\s+)?${ops}(?:ed|d)\\b`, "gi"),
        // "the late checkout is approved", "your extension is confirmed".
        // Bare "is set" is excluded — it is far more often descriptive
        // ("the flag is set by Airbnb") than a completion claim.
        new RegExp(
            `\\b(?:is|are)\\s+(?:already\\s+|now\\s+)?(?:approved|confirmed|booked|reserved|scheduled|arranged|noted|sorted|handled)\\b`,
            "gi"
        ),
        // "you're all set", "everything is taken care of"
        /\b(?:you(?:['’]re| are)|everything(?:['’]s| is)|it(?:['’]s| is)|that(?:['’]s| is))\s+(?:all\s+set|good\s+to\s+go|taken\s+care\s+of|sorted|handled)\b/gi,
        // "I've made a note", "we put in the request" — logging framed as action
        /\b(?:i|we)\s*(?:['’]ve|\s+have)?\s*(?:already\s+)?(?:made\s+a\s+note|put\s+in\s+the\s+request|submitted\s+the\s+request)\b/gi,
    ];
    for (const re of completionPatterns) scan(re, "completion");

    // --- progress: ops has started, as distinct from the agent looking into it ---
    // "the team is already arranging", "our team is working to coordinate"
    const progressRe = new RegExp(
        `\\b${SUBJECT}\\s+(?:is|are|was|were)\\s+(?:already\\s+|currently\\s+|now\\s+)?` +
            `(?:(?:working|trying)\\s+to\\s+|in\\s+the\\s+process\\s+of\\s+)?(?!${inquiry})${ops}\\w*`,
        "gi"
    );
    scan(progressRe, "progress");

    // "the team is already working on it", "we're handling it", "they're taking
    // care of it" — progress claims with no explicit ops verb. These carried the
    // Aug 2026 audit's top failure (locked-out guest told "the team is already
    // working on it" with nothing logged) and the pattern above misses them
    // because nothing from OPS_ACTION_STEMS follows "working".
    const genericProgressRe = new RegExp(
        `\\b(?:${SUBJECT}\\s+(?:is|are|was|were)|i['’]m|we['’]re|they['’]re)\\s+` +
            `(?:already\\s+|currently\\s+|now\\s+)?(?:working\\s+on|handling|taking\\s+care\\s+of)\\b`,
        "gi"
    );
    scan(genericProgressRe, "progress");

    // "will be delivered", "they'll be set up", "we'll have it ready"
    const futureRe = new RegExp(
        `\\b(?:will\\s+be|they['’]ll\\s+be|it['’]ll\\s+be|we['’]ll\\s+have)\\s+(?:\\w+\\s+){0,3}(?:${ops}(?:ed|d)?|ready|waiting)\\b`,
        "gi"
    );
    scan(futureRe, "progress");

    // --- eta: a time pinned to ops work ---
    // Sentence-scoped so that stating a standard check-in time ("check-in is
    // after 4:00 PM") is not mistaken for promising an ops appointment.
    const timeRe = new RegExp(`\\b(?:between|around|by|at|before|after|from)\\s+(?:${CLOCK})`, "i");
    const opsRe = new RegExp(`\\b${ops}`, "i");
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
        const timeHit = sentence.match(timeRe);
        if (!timeHit || !opsRe.test(sentence)) continue;
        add(sentence, "eta");
    }

    return [...found.values()].slice(0, 6);
}

/**
 * Topics where the answer is the team's to give, not the bot's: they cost money,
 * consume housekeeping time, or bend a rule. Settings and the Upsells SDTO rules
 * decide whether a fee may be quoted; nobody may grant the request itself.
 */
const DISCRETIONARY_ASK =
    /\b(early\s+check\s*-?\s*in|late\s+check\s*-?\s*out|check\s+out\s+(?:late|at)|(?:extra|additional|more|another|one\s+more)\s+(?:guest|person|people|adult|child|children|kid|baby|infant|bed|night|car)|bring(?:ing)?\s+(?:a\s+)?(?:pet|dog|cat)|party|gathering|event|luggage\s+drop|drop\s+(?:our|my|the)\s+bags|store\s+(?:our|my)\s+(?:bags|luggage)|extend(?:ing)?|waive|discount|refund|pay\s+(?:by|on|later)|payment\s+(?:by|on|deadline)|exception)\b/i;

/**
 * The bot answering "yes" to a discretionary ask. The team's own replies to
 * these are almost always "we'd be happy to check" — an affirmative here is a
 * commitment nobody authorised.
 */
export function unauthorizedApproval(reply: string, guestText: string): OpsClaim[] {
    const ask = String(guestText || "");
    if (!ask.trim() || !DISCRETIONARY_ASK.test(ask)) return [];

    const text = String(reply || "");
    const found = new Map<string, OpsClaim>();
    const add = (m: string | undefined) => {
        const t = (m || "").replace(/\s+/g, " ").trim();
        if (t && !found.has(t)) found.set(t, { text: t.slice(0, 120), kind: "completion" });
    };

    const affirmatives: RegExp[] = [
        // A reply that opens by saying yes to the ask.
        /^\s*(?:hi\s+[\w'-]+[,!.]?\s*)?(?:yes|yep|absolutely|of\s+course|sure)\b[^.!?\n]{0,90}/i,
        // "that works", "12pm is fine", "that's no problem"
        /\b(?:that|this|it|\d{1,2}\s*(?:am|pm))\s+(?:works|is\s+fine|is\s+no\s+problem|will\s+work|sounds\s+good)\b[^.!?\n]{0,60}/gi,
        // "no extra charge", "no additional fee"
        /\bno\s+(?:extra|additional)?\s*(?:charge|cost|fee)\b[^.!?\n]{0,60}/gi,
        // "you're welcome to", "you can absolutely"
        /\byou(?:['’]re| are)\s+(?:more\s+than\s+)?(?:welcome\s+to|free\s+to|absolutely\s+welcome)\b[^.!?\n]{0,60}/gi,
        // "we can accommodate an extra guest". Quoting a documented upsell price
        // ("we can offer a 12 PM checkout for $155") is sanctioned by the Upsells
        // SDTO rules and gated separately, so a clause carrying a fee is skipped.
        /\bwe\s+(?:can|are\s+able\s+to)\s+(?:accommodate|offer|do)\b(?![^.!?\n]{0,80}(?:[$€£]\s?\d|\bfee\b))[^.!?\n]{0,60}/gi,
        // "late checkout on the 24th is possible"
        /\bis\s+(?:definitely\s+|certainly\s+)?possible\b[^.!?\n]{0,60}/gi,
    ];
    for (const re of affirmatives) {
        for (const m of text.match(re) || []) add(m);
    }
    return [...found.values()].slice(0, 3);
}

export type OpsEvidence = {
    /** An ops line for this reservation is recorded complete. */
    hasCompleted: boolean;
    /** An ops line for this reservation is open / in progress. */
    hasOpenWork: boolean;
};

/**
 * Decide which state claims the reply is not entitled to make.
 *
 * A new inbound request always wins: nothing can be done, in progress, or
 * scheduled for a request that arrived moments ago, and ticket detection runs
 * minutes behind the reply so the ledger cannot vouch for it either.
 */
export function unsupportedOpsClaims(params: {
    reply: string;
    guestText: string;
    evidence: OpsEvidence;
    /** Set when the thread already carries an approval for the discretionary ask. */
    approvalOnRecord?: boolean;
}): OpsClaim[] {
    const { hasCompleted, hasOpenWork } = params.evidence;
    const isNewRequest = guestMakesNewRequest(params.guestText);

    const stateClaims = detectOpsStateClaims(params.reply).filter((c) => {
        if (isNewRequest) return true;
        if (c.kind === "completion" || c.kind === "eta") return !hasCompleted;
        return !hasOpenWork && !hasCompleted;
    });

    const approvals = params.approvalOnRecord
        ? []
        : unauthorizedApproval(params.reply, params.guestText);

    const merged = new Map<string, OpsClaim>();
    for (const c of [...stateClaims, ...approvals]) if (!merged.has(c.text)) merged.set(c.text, c);
    return [...merged.values()].slice(0, 6);
}
