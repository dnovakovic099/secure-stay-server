/**
 * Structural assert_when policy for inbox AI facts.
 *
 * Facts are not just HARD/SOFT — each shareable fact has a condition. When the
 * condition fails, the model gets a POLICY line instead of the raw fact.
 */

export type AssertWhen =
    | "always"
    | "booked_and_ask"
    | "checkin_day_or_midstay"
    | "fee_only_not_approval"
    | "never_assert_completion";

export interface AssertableFact {
    id: string;
    assertWhen: AssertWhen;
    /** Shown when condition passes. */
    assertText: string;
    /** Shown when condition fails (policy substitute). */
    policyText: string;
    kind?: string;
}

export interface AssertEvalContext {
    stayStageLine: string | null;
    isBooked: boolean;
    guestText: string;
    /** True when guest message looks like a lockout / code-not-working report. */
    lockoutAsk: boolean;
    /** True when guest is asking about wifi/network. */
    wifiAsk: boolean;
    /** True when guest asked for rental agreement / deposit authorization link. */
    agreementAsk: boolean;
    /** True when an ops task for THIS reservation explicitly confirms completion/ETA. */
    hasExplicitOpsConfirmation: boolean;
}

export function isCheckinDayOrMidStay(stayStageLine: string | null): boolean {
    return /CHECK-IN IS TODAY|MID-STAY|CHECKOUT IS TODAY/i.test(String(stayStageLine || ""));
}

export function guestReportsLockout(text: string): boolean {
    return /\b(lock(?:ed)?\s*out|can'?t get in|cannot get in|code (?:is )?(?:not )?work|door won'?t|won'?t (?:open|unlock)|access(?:\s+code)? (?:is )?(?:wrong|invalid|not working))\b/i.test(
        String(text || "")
    );
}

export function guestAsksWifi(text: string): boolean {
    return /\b(wifi|wi-?\s*fi|wireless|network\s*name|password\s*for\s*(the\s*)?(wifi|internet))\b/i.test(
        String(text || "")
    );
}

export function guestAsksAgreement(text: string): boolean {
    return /\b(rental agreement|lease agreement|sign(ing)? (the )?(agreement|contract)|deposit (auth|authorization|link)|secure\s*link|charge\s*automation)\b/i.test(
        String(text || "")
    );
}

/** Task/issue text that explicitly authorizes stating completion or an ETA. */
export function opsTextExplicitlyConfirmed(text: string): boolean {
    return /\b(confirmed|completed|done|delivered|scheduled for|eta[:\s]|will arrive (by|at)|arriving (by|at)|set for)\b/i.test(
        String(text || "")
    );
}

export function evaluateAssertWhen(when: AssertWhen, ctx: AssertEvalContext): boolean {
    switch (when) {
        case "always":
            return true;
        case "booked_and_ask":
            return ctx.isBooked && ctx.wifiAsk;
        case "checkin_day_or_midstay":
            return isCheckinDayOrMidStay(ctx.stayStageLine) || ctx.lockoutAsk;
        case "fee_only_not_approval":
            // Fee lines are always showable; approval language is gated in claim checks.
            return true;
        case "never_assert_completion":
            return ctx.hasExplicitOpsConfirmation;
        default:
            return false;
    }
}

export function partitionAssertFacts(
    facts: AssertableFact[],
    ctx: AssertEvalContext
): { assertable: AssertableFact[]; policy: AssertableFact[] } {
    const assertable: AssertableFact[] = [];
    const policy: AssertableFact[] = [];
    for (const f of facts) {
        // Empty assertText = policy-only (e.g. contested conflict / unknown).
        if (f.assertText?.trim() && evaluateAssertWhen(f.assertWhen, ctx)) assertable.push(f);
        else policy.push(f);
    }
    return { assertable, policy };
}

export function renderAssertPolicyBlock(facts: AssertableFact[], ctx: AssertEvalContext): string | null {
    if (!facts.length) return null;
    const { assertable, policy } = partitionAssertFacts(facts, ctx);
    const lines: string[] = [
        "## Assert policy (structural — conditions gate what you may state)",
        "Only lines under ASSERTABLE may be stated as certain. POLICY lines are instructions, not guest facts.",
    ];
    if (assertable.length) {
        lines.push("");
        lines.push("### ASSERTABLE (condition met)");
        for (const f of assertable) {
            lines.push(`- [${f.assertWhen}${f.kind ? ` / ${f.kind}` : ""}] ${f.assertText}`);
        }
    }
    if (policy.length) {
        lines.push("");
        lines.push("### POLICY (condition not met — follow this instead of inventing)");
        for (const f of policy) {
            lines.push(`- [${f.assertWhen}${f.kind ? ` / ${f.kind}` : ""}] ${f.policyText}`);
        }
    }
    // Always remind fee vs approval split for extensions; early/late follow Settings.
    lines.push("");
    lines.push("### Decision vs price (always)");
    lines.push(
        "- Upsell/extension FEES may be quoted. For early check-in / late check-out, follow the EARLY CHECK-IN / LATE CHECK-OUT HANDLING settings in the system prompt. Other discretionary approvals (extensions beyond listed nights, fee waivers) are NEVER assertable."
    );
    return lines.join("\n");
}

export type EarlyLateCheckHandling = "defer_to_team" | "deny" | "quote_fee_and_defer" | "accept_with_fee";

export function renderEarlyLateCheckPolicy(
    early: EarlyLateCheckHandling | string | null | undefined,
    late: EarlyLateCheckHandling | string | null | undefined
): string {
    const normalize = (raw: any): EarlyLateCheckHandling => {
        const v = String(raw || "")
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, "_");
        if (v === "deny" || v === "quote_fee_and_defer" || v === "accept_with_fee" || v === "defer_to_team") {
            return v;
        }
        return "defer_to_team";
    };
    const describe = (label: string, mode: EarlyLateCheckHandling): string => {
        switch (mode) {
            case "deny":
                return `- ${label}: DENY. Politely say standard check-in/out times apply and early/late is not available. Do NOT approve a special time. Still set escalation_required=true so the team sees the ask.`;
            case "quote_fee_and_defer":
                return `- ${label}: QUOTE FEE + DEFER. If a listed fee appears in Available paid services, state it. Say the team must confirm availability. NEVER approve or promise a time. escalation_required=true.`;
            case "accept_with_fee":
                return `- ${label}: ACCEPT WITH FEE when a fee is listed in Available paid services — you may approve subject to that fee and availability. If no fee is listed, defer to the team (do not invent a price or approve for free). Always escalation_required=true so a human can verify before send.`;
            default:
                return `- ${label}: DEFER TO TEAM. Acknowledge the request. You MAY quote a listed fee if present. Never approve, never deny as blanket policy, never promise a time. Say the team will confirm. escalation_required=true.`;
        }
    };
    return [
        "EARLY CHECK-IN / LATE CHECK-OUT HANDLING (team settings — follow strictly):",
        describe("Early check-in", normalize(early)),
        describe("Late check-out", normalize(late)),
        "- Only skip this policy when a TEAM message in THIS thread already decided this exact request.",
    ].join("\n");
}

export interface SpeechActGateOpts {
    codesAllowed: boolean;
    agreementAsk: boolean;
    hasExplicitOpsConfirmation: boolean;
    /** True only when reservation status is accepted/confirmed/in-house (not inquiry/pending/unknown). */
    bookingConfirmed?: boolean;
    /** Guest message text — used to scope early vs late handling. */
    guestText?: string;
    earlyCheckinHandling?: EarlyLateCheckHandling | string;
    lateCheckoutHandling?: EarlyLateCheckHandling | string;
    /** True when drafting a reply to a PM/owner client (not a guest). */
    pmClient?: boolean;
}

/** Guest has a real booked stay — not inquiry / preapproved / pending / unknown. */
export function isBookingConfirmedStatus(status?: string | null): boolean {
    const s = String(status || "")
        .toLowerCase()
        .replace(/[\s_-]/g, "");
    if (!s) return false;
    return (
        s === "accepted" ||
        s === "confirmed" ||
        s === "checkedin" ||
        s === "checkedout" ||
        s.startsWith("accepted") ||
        s.startsWith("confirmed")
    );
}

function normalizeHandling(raw: any): EarlyLateCheckHandling {
    const v = String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    if (v === "deny" || v === "quote_fee_and_defer" || v === "accept_with_fee" || v === "defer_to_team") {
        return v;
    }
    return "defer_to_team";
}

function replyLooksLikeApproval(text: string): boolean {
    return /\b(yes[,.]?\s+you can|that (?:should |will )?work|i can (?:offer|arrange|approve|do that)|you(?:'re| are) (?:approved|good|set) for|is possible(?:\s+since|\s+for)?|i(?:'ve| have) (?:arranged|approved|confirmed)|we can (?:definitely |certainly )?do that|you're all set for)\b/i.test(
        text
    );
}

function replyMentionsFee(text: string): boolean {
    return /\$\s*\d|\b\d+\s*(?:dollars?|usd)\b|\b(?:for|at|of)\s+(?:a\s+)?(?:\$?\d[\d,]*(?:\.\d+)?|\d+)\s*(?:dollar)?\s*fee\b|\bfee\b/i.test(
        text
    );
}

/**
 * Post-draft speech-act gate: catch unsafe claims even when numbers appear in context.
 */
export function detectUnsafeSpeechActs(reply: string, opts: SpeechActGateOpts): string[] {
    const text = String(reply || "");
    const hits: string[] = [];
    const guestOrReply = `${opts.guestText || ""} ${text}`;

    const earlyTopic =
        /\bearly[\s-]*check[\s-]*in\b|\bcheck[\s-]*in\s+(early|earlier)\b|\barrive early\b|\bget in early\b/i.test(
            guestOrReply
        );
    const lateTopic =
        /\b(late|extended?)[\s-]*check[\s-]*out\b|\bcheck[\s-]*out\s+(late|later|extension)\b|\bleave late\b/i.test(
            guestOrReply
        );
    const otherDiscretionary =
        /\bextension\b|\bstay longer\b|\bextra night\b/i.test(text) && !earlyTopic && !lateTopic;

    const gateEarlyLate = (topic: "early" | "late", modeRaw: any) => {
        const mode = normalizeHandling(modeRaw);
        const approving = replyLooksLikeApproval(text);
        const timeApproval =
            /\b(?:late|early)[\s-]*check[\s-]*(?:out|in)\b[^.!?\n]{0,40}\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(
                text
            ) && /\b(fine|ok|okay|approved|confirmed|arranged|possible|works)\b/i.test(text);

        if (mode === "accept_with_fee") {
            // Allowed to approve only when a fee is mentioned in the reply.
            if ((approving || timeApproval) && !replyMentionsFee(text)) {
                hits.push(topic === "early" ? "early_checkin_accept_without_fee" : "late_checkout_accept_without_fee");
            }
            return;
        }
        if (mode === "deny") {
            if (approving || timeApproval) {
                hits.push(topic === "early" ? "early_checkin_approval_when_deny" : "late_checkout_approval_when_deny");
            }
            return;
        }
        // defer_to_team | quote_fee_and_defer — never approve.
        if (approving) hits.push("discretionary_approval");
        if (timeApproval) hits.push("discretionary_time_approval");
    };

    if (earlyTopic) gateEarlyLate("early", opts.earlyCheckinHandling);
    if (lateTopic) gateEarlyLate("late", opts.lateCheckoutHandling);

    if (otherDiscretionary) {
        if (replyLooksLikeApproval(text)) hits.push("discretionary_approval");
    }

    if (!opts.codesAllowed) {
        if (
            /\b(?:door|lock|gate|access|entry)\s*code\b[^.\n]{0,40}\b\d{3,}/i.test(text) ||
            /\bcode(?:\s+is|\s*:)\s*[A-Za-z0-9#-]{4,}\b/i.test(text) ||
            /\b\d{2,}[-–]\d{2,}(?:[-–]\d{2,})?\b/.test(text)
        ) {
            hits.push("prearrival_access_code");
        }
    }

    if (!opts.hasExplicitOpsConfirmation) {
        if (
            /\b(already (?:working|arranged|ordered|scheduled|confirmed|delivered)|team is (?:already )?(?:working on|arranging|ordering)|will be delivered|deliver(?:y|ed) (?:by|at|tonight|today)|on(?:-|\s)?site right now|cleaner is (?:there|on.?site))\b/i.test(
                text
            )
        ) {
            hits.push("unconfirmed_ops_completion");
        }
        // Amenity/gear fulfillment promises (qty or "we'll provide") without ops confirm.
        const gearTopic =
            /\b(pack[\s-]*n[\s-]*plays?|pack[\s-]*and[\s-]*plays?|playards?|high[\s-]*chairs?|booster\s+seats?|cribs?|porta[\s-]*cribs?|travel\s+cribs?|rollaways?|air\s*mattress(?:es)?|extra\s+(beds?|cots?|towels?|pillows?|blankets?))\b/i.test(
                text
            );
        if (gearTopic) {
            // Allow "we'll check / confirm how many" — block only fulfillment claims.
            const checkingOnly =
                /\b(check|checking|confirm how many|see (?:if|what)|find out|with the (?:owner|team))\b/i.test(
                    text
                ) && !/\b(already (?:working|arranging)|arrang(?:e|ing) \d+|everything (?:is|will be) set)\b/i.test(text);
            const promisesFulfillment =
                /\b(already (?:working|arranging)|(?:we are|we're|team is) (?:working to )?arrang(?:e|ing)|(?:we can|we will|we'll|i will|i'll) (?:provide|bring|get|set up)|everything (?:is|will be) set|all set for)\b/i.test(
                    text
                ) || /\b\d+\s+(?:pack|high[\s-]*chairs?|cribs?|rollaways?|playards?)\b/i.test(text);
            if (promisesFulfillment && !checkingOnly) {
                hits.push("unconfirmed_gear_fulfillment");
            }
        }
    }

    if (opts.agreementAsk) {
        if (/hostify\.com\/checkin/i.test(text)) {
            hits.push("hostify_checkin_as_agreement");
        }
    }

    // Call scheduling: AI must not offer availability or pick a time.
    if (
        /\b(i can (?:make time for |do )?a call|call (?:you |me )?(?:today|tomorrow)|jump on a call|(?:free|available) (?:for a call|to talk|to chat)|let'?s (?:schedule|set up) a call|what time (?:works|is good) for (?:a |the )?call)\b/i.test(
            text
        ) ||
        (/\b(call|phone chat|phone call)\b/i.test(text) &&
            /\b(today|tomorrow|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(text) &&
            /\b(i can|i'?ll|we can|works for me|i'?m free|available)\b/i.test(text))
    ) {
        hits.push("call_scheduling_offer");
    }

    // Booking confirmation claims without accepted/confirmed status (Jada case).
    if (!opts.bookingConfirmed) {
        if (
            /\b(your reservation is confirmed|reservation is confirmed|booking is confirmed|you(?:'re| are) confirmed for|you have a (?:confirmed )?reservation|you(?:'ll| will) have a place(?: to go)?|everything is set for (?:your|the) (?:stay|arrival|reservation))\b/i.test(
                text
            )
        ) {
            hits.push("unconfirmed_booking_claim");
        }
    }

    // Complimentary / free / goodwill approvals without explicit ops/team confirm.
    if (!opts.hasExplicitOpsConfirmation) {
        const compTopic =
            /\b(complimentary|comp(?:ed)?|free\s+night|goodwill(?:\s+credit)?|credit\s+night)\b/i.test(text) ||
            /\b(complimentary|comp(?:ed)?|free\s+night|goodwill)\b/i.test(opts.guestText || "");
        if (
            compTopic &&
            /\b(confirmed|approved|arranged|granted|taken care of|you(?:'re| are) all set|all set for|we(?:'ve| have) (?:added|comp(?:ed)?|waived))\b/i.test(
                text
            )
        ) {
            hits.push("unconfirmed_complimentary");
        }
    }

    // Invented local events / property-experience claims (often wrong_info).
    if (
        /\b(festival|concert|local event|(?:football|baseball|basketball|hockey)\s+game|this weekend'?s (?:game|festival|concert))\b/i.test(
            text
        ) &&
        /\b(there(?:'s| is)|we have|you(?:'ll| will)|happening|going on|in town|nearby)\b/i.test(text) &&
        !/\b(team will|we(?:'ll| will) check|not sure|confirm|if (?:you(?:'re| are) interested)|from (?:our|the) (?:notes|knowledge))\b/i.test(
            text
        )
    ) {
        hits.push("invented_local_event");
    }
    if (
        /\b(trains? (?:are|is|can be) (?:quiet|loud|noisy|barely audible)|you(?:'ll| will) (?:barely |not )?hear (?:the )?trains?|lake is (?:swimmable|great for swimming|safe to swim)|beach is (?:only )?\d+\s*(?:min|minutes)|quiet neighborhood|no (?:train|road) noise)\b/i.test(
            text
        )
    ) {
        hits.push("invented_property_experience");
    }

    // PM/owner occupancy: never absolute; never re-assert when they dispute Hostify.
    if (opts.pmClient) {
        if (/\b(both units (?:are )?booked|definitely booked|there is definitely (?:a )?(?:guest|booking)|units are (?:both )?booked)\b/i.test(text)) {
            hits.push("absolute_occupancy_claim");
        }
        const ownerDisputes =
            /\b(no booking|no reservation|that(?:'s| is) not right|calendar is wrong|was cancel+ed|there (?:is|are) no guest|not booked|you(?:'re| are) wrong|i don'?t (?:see|have) (?:a )?booking)\b/i.test(
                opts.guestText || ""
            );
        const reasserts =
            /\b(both units|currently (?:hosting|booked)|there (?:is|are) (?:a |guests?|bookings?)|on the books|guest(?:s)? (?:named|is|are))\b/i.test(
                text
            ) && !/\b(Hostify|our (?:reservation )?system) shows\b/i.test(text);
        if (ownerDisputes && reasserts) {
            hits.push("occupancy_dispute_reassert");
        }
    }

    return [...new Set(hits)];
}
