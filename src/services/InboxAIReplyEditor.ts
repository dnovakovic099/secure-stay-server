/**
 * InboxAIReplyEditor — second-pass rewrite of a drafted guest reply.
 *
 * Replaces soft "score the draft" verification for risky messages with an
 * editor that gets the same context + the draft + a catalog of real failure
 * modes, then rewrites. Structured `still_unanswered` lets code block
 * auto-send when the editor still couldn't cover an ask.
 *
 * Mode (AI_MESSAGING_EDITOR_MODE):
 *   shadow (default) — run + log; keep original draft; keep score verifier for autosend
 *   live             — apply rewrite; synthesize verifier score from editor outcome
 *   off              — disabled
 */

export type ReplyEditorMode = "off" | "shadow" | "live";

export type ReplyEditorResult = {
    reply: string;
    guestAsks: string[];
    stillUnanswered: string[];
    changesMade: string[];
    triggeredBy: string[];
};

export function replyEditorMode(): ReplyEditorMode {
    const v = String(process.env.AI_MESSAGING_EDITOR_MODE || "shadow")
        .trim()
        .toLowerCase();
    if (v === "live" || v === "on" || v === "1" || v === "true") return "live";
    if (v === "off" || v === "0" || v === "false") return "off";
    return "shadow";
}

export function replyEditorModel(): string {
    return process.env.AI_MESSAGING_EDITOR_MODEL || process.env.AI_MESSAGING_MODEL || "gpt-4.1";
}

/**
 * Risk signals that justify spending a second LLM call. Tuned from Jul–Aug
 * audit themes: ignored multi-part asks, wrong fees, needless deferral,
 * deposit/payment, access codes, early/late check.
 */
export function replyEditorTriggers(
    guestText: string,
    confidencePct: number | null,
    draftReply: string
): string[] {
    const g = String(guestText || "");
    const draft = String(draftReply || "");
    if (!g.trim() || !draft.trim()) return [];
    const triggers: string[] = [];

    const qMarks = (g.match(/\?/g) || []).length;
    if (qMarks >= 2) triggers.push("multi_question");
    if (
        /\b(also|as well|another|plus|second(ly)?|first[,:]|and\s+(?:also|do|can|is|are|what|when|where|how|which))\b/i.test(
            g
        )
    ) {
        triggers.push("multi_part");
    }
    if (/\$|\b(fee|deposit|payment|refund|charge|pre-?auth|price|cost|invoice)\b/i.test(g)) {
        triggers.push("money");
    }
    if (/\b(code|lock|door|gate|check[- ]?in instruction|access|parking|wifi|password)\b/i.test(g)) {
        triggers.push("access");
    }
    if (
        /\b(early check|late check|check[- ]?in early|check[- ]?out late|arrive early|checkout late)\b/i.test(
            g
        )
    ) {
        triggers.push("early_late");
    }
    if (/\b(availab|booked|extend|extra night|pet|tub|amenit|grill|pool|laundry)\b/i.test(g)) {
        triggers.push("fact_sensitive");
    }
    if (confidencePct != null && confidencePct < 70) triggers.push("low_confidence");
    if (
        /\b(i(['’]?ll| will) (check|confirm|look into|find out)|team will (confirm|check|follow|get)|get back to you|follow up shortly)\b/i.test(
            draft
        ) &&
        /\b(fee|\$|available|code|tub|wifi|deposit|price|pet|early|late)\b/i.test(g)
    ) {
        triggers.push("deferral_risk");
    }
    return [...new Set(triggers)];
}

function editorSystemPromptBase(): string {
    return [
        "You are the EDITOR for a short-term-rental guest-messaging AI.",
        "Another model already drafted a reply. You get the SAME CONTEXT it had, the guest's latest message, and that draft.",
        "Your job: improve the draft so it is safe to send — fix the failure modes below. Do NOT start from scratch unless the draft is unusable.",
        "",
        "COMMON FAILURES (fix these when they apply — these are real past mistakes):",
        "1. IGNORED ASK — guest asked multiple things; draft answered only some. List EVERY explicit question/request in the guest's latest message and address each one, or say you are checking that specific part.",
        "2. WRONG FEE / PRICE — invented or stale early check-in, late checkout, pet, parking, or upsell fees. Only quote amounts that appear in CONTEXT (Available paid services / Upsells, Reservation billing, VERIFIED FACTS, TEAM messages). If the amount isn't there, do not invent — say the team will confirm the exact cost.",
        "3. NEEDLESS DEFERRAL — draft says \"I'll check with the team\" when CONTEXT already has the answer (fee, policy, amenity, code, availability). Answer directly from context instead.",
        "4. DEPOSIT / PAYMENT — wrong claims about deposit required/paid/released, payment declined vs went through, pre-auth holds. Prefer live Reservation billing fields; if unclear, say the team will confirm.",
        "5. ACCESS / CODES / CHECK-IN — missing parking/entry steps the context has; sharing a door code when context says deposit unpaid or codes are not shareable yet. Never invent codes.",
        "6. AMENITY / PROPERTY FACTS — inventing tubs, pull-out sofas, beach gear, laundry access, event policy. Only state what CONTEXT supports; otherwise escalate that part.",
        "7. AVAILABILITY — claiming dates open/booked without support from the availability/calendar block in context.",
        "8. FALSE OPS STATUS — claiming something is already approved, arranged, scheduled, or being worked on without ops evidence in context. Rephrase as a commitment to get it to the team.",
        "9. LANGUAGE — reply in the same language the guest used.",
        "10. LENGTH — keep it short (1–5 sentences). Friendly host texting, not a corporate email.",
        "",
        "HARD RULES:",
        "- You may ADD facts that are clearly present in CONTEXT but missing from the draft.",
        "- You must NEVER invent fees, codes, amenities, availability, approvals, or ETAs not in CONTEXT.",
        "- If CONTEXT lacks the answer for an ask, keep/acknowledge that ask in still_unanswered and give a safe holding line for it.",
        "- Prefer the draft's good parts (tone, correct facts). Only change what is wrong or incomplete.",
        "",
        "Return STRICT JSON only:",
        '{',
        '  "guest_asks": ["short list of every explicit question/request in the guest latest message"],',
        '  "reply": "full improved reply to send",',
        '  "still_unanswered": ["asks you still could not answer from context — empty array if all covered"],',
        '  "changes_made": ["brief notes of what you fixed"]',
        "}",
    ].join("\n");
}

async function editorSystemPrompt(): Promise<string> {
    let dynamic = "";
    try {
        const { InboxAIEditorOptimizeService } = await import("./InboxAIEditorOptimizeService");
        dynamic = await new InboxAIEditorOptimizeService().getActiveLessonsPromptBlock();
    } catch {
        dynamic = "";
    }
    // Insert daily lessons before HARD RULES so they stay salient.
    const base = editorSystemPromptBase();
    if (!dynamic) return base;
    return base.replace("\nHARD RULES:", `${dynamic}\n\nHARD RULES:`);
}

export async function runReplyEditor(params: {
    openai: { chat: { completions: { create: Function } } };
    context: string;
    guestText: string;
    draftReply: string;
    triggeredBy: string[];
    timeoutMs?: number;
}): Promise<ReplyEditorResult | null> {
    const draft = String(params.draftReply || "").trim();
    const guest = String(params.guestText || "").trim();
    if (!draft || !guest) return null;
    const timeoutMs = params.timeoutMs ?? 20000;

    try {
        const system = await editorSystemPrompt();
        const completion = await Promise.race([
            params.openai.chat.completions.create({
                model: replyEditorModel(),
                temperature: 0,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: system },
                    {
                        role: "user",
                        content: [
                            "=== CONTEXT (same facts the drafter had) ===",
                            params.context.slice(0, 100000),
                            "",
                            "=== GUEST'S LATEST MESSAGE ===",
                            guest,
                            "",
                            "=== DRAFTED REPLY TO IMPROVE ===",
                            draft,
                            "",
                            `Risk triggers that selected this edit: ${params.triggeredBy.join(", ") || "none"}`,
                        ].join("\n"),
                    },
                ],
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]);
        if (!completion) return null;
        const parsed = JSON.parse(completion.choices?.[0]?.message?.content?.trim() || "{}");
        const reply = String(parsed.reply || "").trim();
        if (!reply) return null;
        const asList = (v: unknown): string[] =>
            Array.isArray(v)
                ? v.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12)
                : [];
        return {
            reply,
            guestAsks: asList(parsed.guest_asks),
            stillUnanswered: asList(parsed.still_unanswered),
            changesMade: asList(parsed.changes_made),
            triggeredBy: params.triggeredBy,
        };
    } catch {
        return null;
    }
}

/** Autosend-facing score derived from editor outcome (live mode). */
export function verifierFromEditor(result: ReplyEditorResult): { confidence: number; note: string } {
    if (result.stillUnanswered.length) {
        return {
            confidence: 40,
            note: `editor:unanswered:${result.stillUnanswered.join("; ").slice(0, 200)}`,
        };
    }
    const fixed = result.changesMade.length
        ? `editor:ok fixed ${result.changesMade.length}`
        : "editor:ok";
    return { confidence: 92, note: fixed.slice(0, 255) };
}

export function attachEditorToRawResponse(
    raw: string | null,
    meta: {
        mode: ReplyEditorMode;
        triggeredBy: string[];
        result: ReplyEditorResult | null;
        applied: boolean;
        draftBefore?: string;
    }
): string {
    const payload = {
        mode: meta.mode,
        triggeredBy: meta.triggeredBy,
        applied: meta.applied,
        draftBefore: meta.draftBefore ? String(meta.draftBefore).slice(0, 4000) : null,
        guestAsks: meta.result?.guestAsks || [],
        stillUnanswered: meta.result?.stillUnanswered || [],
        changesMade: meta.result?.changesMade || [],
        editedReply: meta.result?.reply ? String(meta.result.reply).slice(0, 4000) : null,
    };
    const marker = "\n\n<!--EDITOR-->";
    const base = String(raw || "");
    const without = base.includes(marker) ? base.slice(0, base.indexOf(marker)) : base;
    return `${without}${marker}${JSON.stringify(payload)}`.slice(0, 60000);
}

export function parseEditorFromRawResponse(raw: string | null): {
    stillUnanswered: string[];
    applied: boolean;
    mode: string | null;
} | null {
    const s = String(raw || "");
    const idx = s.indexOf("<!--EDITOR-->");
    if (idx < 0) return null;
    try {
        const parsed = JSON.parse(s.slice(idx + "<!--EDITOR-->".length));
        return {
            stillUnanswered: Array.isArray(parsed.stillUnanswered)
                ? parsed.stillUnanswered.map(String)
                : [],
            applied: Boolean(parsed.applied),
            mode: parsed.mode ? String(parsed.mode) : null,
        };
    } catch {
        return null;
    }
}
