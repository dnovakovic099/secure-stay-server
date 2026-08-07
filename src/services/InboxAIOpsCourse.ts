/**
 * General "ops course" planner for Inbox AI proposed actions.
 *
 * Same concept as specialty plans (late checkout, access, handover) — but for
 * anything a rep might need to do: follow up guest/owner/vendor, update ticket,
 * notify reps, or a low-confidence guess when unsure.
 *
 * Preview-only (Accept stays disabled). Surfaces in the existing AI plan strip.
 */

import OpenAI from "openai";
import { RecommendedActionStep } from "./AIProposedActionService";

export const OPS_COURSE_ACTION_TYPE = "ops_course";

export type OpsCoursePlan = {
    title: string;
    planSummary: string;
    evidence: string;
    proposedReply: string | null;
    taskDescription: string | null;
    overallConfidence: number;
    recommendedSteps: RecommendedActionStep[];
    plannedChannels: Record<string, string | null>;
};

export type OpsCourseSignals = {
    guestText: string;
    guestName?: string | null;
    listingName?: string | null;
    reservationStatus?: string | null;
    draftReply?: string | null;
    escalationRequired?: boolean;
    escalationReason?: string | null;
    suggestedActionItems?: string[];
    warnings?: string[];
    confidencePct?: number | null;
    openGuestIssueCount?: number;
};

const ACK_RE =
    /^(ok(ay)?|thanks?( you)?|thank you|thx|ty|got it|perfect|great|awesome|sounds good|will do|👍|🙏)[\s!.]*$/i;

export function shouldProposeOpsCourse(guestText: string): boolean {
    const t = String(guestText || "").trim();
    if (!t || t.length < 8) return false;
    if (ACK_RE.test(t)) return false;
    // Platform noise
    if (/^(inquiry_created|reservation_|booking_)/i.test(t)) return false;
    return true;
}

function clip(s: string, n: number): string {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0.4;
    return Math.max(0, Math.min(1, n));
}

function step(
    id: string,
    label: string,
    opts: Partial<RecommendedActionStep> & { confidence: number }
): RecommendedActionStep {
    return {
        id,
        label,
        detail: opts.detail,
        status: opts.status || (opts.confidence < 0.45 ? "guess" : "recommended"),
        confidence: clamp01(opts.confidence),
        actor: opts.actor,
        channel: opts.channel,
    };
}

/**
 * Fast heuristic plan when LLM is unavailable. Always produces at least one
 * low-confidence guess so Anj can see a course of action.
 */
export function buildOpsCourseDeterministic(signals: OpsCourseSignals): OpsCoursePlan {
    const text = String(signals.guestText || "");
    const lower = text.toLowerCase();
    const steps: RecommendedActionStep[] = [];
    const guestFirst = (signals.guestName || "").split(/\s+/)[0] || "guest";

    const looksMaintenance =
        /\b(broken|not work|leak|dirty|mold|smell|ac\b|a\/c|heat(ing)?|fridge|wifi|internet|hot water|clog|insect|bug|ant|repair|maintenance|out of)\b/i.test(
            text
        );
    const looksAccess = /\b(code|lock|keypad|lockbox|locked out|can'?t get in|door won'?t)\b/i.test(text);
    const looksSchedule =
        /\b(early check|late check|extend|extra night|another night|check[- ]?in|check[- ]?out)\b/i.test(text);
    const looksPayment = /\b(payment|charge|card|deposit|refund|pre-?auth|invoice|paid|billing)\b/i.test(text);
    const looksOwner = /\b(owner|landlord|property manager|pm\b)\b/i.test(text);
    const looksVendor = /\b(vendor|contractor|plumber|electrician|hvac|cleaner|housekeep)\b/i.test(text);

    // Guest-facing reply is almost always step 1.
    steps.push(
        step("reply_guest", "Reply to guest (Hostify)", {
            detail: signals.draftReply
                ? clip(signals.draftReply, 180)
                : "Acknowledge and set expectation; do not claim work is done.",
            confidence: signals.draftReply ? 0.75 : 0.5,
            actor: "guest",
            channel: "hostify",
            status: "blocked",
        })
    );

    if (looksMaintenance) {
        steps.push(
            step("create_or_update_ticket", "Open / update Guest Issue ticket", {
                detail:
                    signals.openGuestIssueCount && signals.openGuestIssueCount > 0
                        ? `${signals.openGuestIssueCount} open issue(s) already — update status / notes`
                        : "Create a Guest Issue if none covers this ask",
                confidence: 0.7,
                actor: "system",
            })
        );
        steps.push(
            step("follow_up_vendor", "Follow up with vendor / contractor if dispatch needed", {
                detail: "Draft Quo SMS or deep-link once vendor is identified",
                confidence: 0.45,
                actor: "vendor",
                channel: "quo",
                status: "guess",
            })
        );
        steps.push(
            step("follow_up_guest", "Follow up with guest after ops update", {
                detail: "Send status once vendor/IR has a real update",
                confidence: 0.55,
                actor: "guest",
                channel: "hostify",
            })
        );
    }

    if (looksAccess) {
        steps.push(
            step("check_access", "Verify live door code / access instructions", {
                detail: "Specialty access plan may also appear if a live code exists",
                confidence: 0.65,
                actor: "system",
            })
        );
    }

    if (looksSchedule) {
        steps.push(
            step("check_schedule_ops", "Run schedule ops checks (calendar + Upsells + cleaner/owner)", {
                detail: "Specialty early/late/extension plan may also appear",
                confidence: 0.7,
                actor: "cleaner",
                channel: "quo",
            })
        );
    }

    if (looksPayment) {
        steps.push(
            step("verify_payment", "Verify payment / deposit status in billing", {
                confidence: 0.6,
                actor: "system",
            })
        );
        steps.push(
            step("notify_rep", "Update other reps if payment rescue needed", {
                confidence: 0.5,
                actor: "rep",
            })
        );
    }

    if (looksOwner || (!looksVendor && /\b(approval|approve|permission)\b/i.test(text))) {
        steps.push(
            step("follow_up_owner", "Follow up with owner if decision needed", {
                detail: "Only when owner approval is required for this ask",
                confidence: 0.4,
                actor: "owner",
                channel: "quo",
                status: "guess",
            })
        );
    }

    if (looksVendor) {
        steps.push(
            step("follow_up_vendor", "Follow up with named vendor / contractor", {
                confidence: 0.55,
                actor: "vendor",
                channel: "quo",
            })
        );
    }

    for (const item of signals.suggestedActionItems || []) {
        const id = `action_item_${steps.length}`;
        steps.push(
            step(id, clip(item, 120), {
                detail: "From AI suggested action items on the draft",
                confidence: 0.55,
                actor: "rep",
                status: "optional",
            })
        );
    }

    if (signals.escalationRequired) {
        steps.push(
            step("notify_rep", "Hand to a live rep (escalation)", {
                detail: clip(signals.escalationReason || "AI flagged escalation", 160),
                confidence: 0.8,
                actor: "rep",
            })
        );
    }

    // If we still only have the reply step, add an explicit low-confidence guess.
    if (steps.length <= 1) {
        steps.push(
            step("unknown_guess", "Guess next ops move (low confidence — edit as needed)", {
                detail: `Likely: confirm what ${guestFirst} needs, log a ticket if operational, and follow up once known`,
                confidence: 0.3,
                actor: "unknown",
                status: "guess",
            })
        );
        steps.push(
            step("notify_rep", "Keep a rep in the loop until the path is clear", {
                confidence: 0.45,
                actor: "rep",
                status: "optional",
            })
        );
    }

    const overall =
        steps.reduce((s, x) => s + (x.confidence ?? 0.4), 0) / Math.max(1, steps.length);

    const theme = looksMaintenance
        ? "maintenance / ops"
        : looksAccess
          ? "access"
          : looksSchedule
            ? "schedule"
            : looksPayment
              ? "payment"
              : "general ops";

    return {
        title: `Course of action — ${theme}`,
        planSummary: `Proposed steps for what a rep would do next (${theme}). Preview only — Accept disabled. Overall confidence ${Math.round(
            overall * 100
        )}%.`,
        evidence: [
            `Guest said: "${clip(text, 240)}"`,
            signals.listingName ? `Listing: ${signals.listingName}` : null,
            signals.reservationStatus ? `Reservation status: ${signals.reservationStatus}` : null,
            signals.escalationRequired
                ? `Escalation: ${signals.escalationReason || "required"}`
                : null,
            (signals.warnings || []).length
                ? `Draft warnings: ${signals.warnings!.slice(0, 3).join("; ")}`
                : null,
            `Planner: deterministic`,
        ]
            .filter(Boolean)
            .join("\n"),
        proposedReply: signals.draftReply ? clip(signals.draftReply, 2000) : null,
        taskDescription: `Ops course (${theme}) for ${signals.guestName || "guest"}: ${clip(text, 180)}`,
        overallConfidence: clamp01(overall),
        recommendedSteps: steps.slice(0, 10),
        plannedChannels: {
            guest: "hostify",
            vendor: looksMaintenance || looksVendor ? "quo" : null,
            owner: looksOwner ? "quo" : null,
            turnover: looksSchedule ? "quo" : null,
            reps: signals.escalationRequired ? "internal" : null,
        },
    };
}

function normalizeLlmSteps(raw: any[]): RecommendedActionStep[] {
    const out: RecommendedActionStep[] = [];
    for (const s of raw || []) {
        if (!s || typeof s !== "object") continue;
        const conf = clamp01(Number(s.confidence ?? 0.5));
        const statusRaw = String(s.status || "").toLowerCase();
        const status: RecommendedActionStep["status"] =
            statusRaw === "blocked" || statusRaw === "optional" || statusRaw === "guess"
                ? (statusRaw as any)
                : conf < 0.45
                  ? "guess"
                  : "recommended";
        const id = clip(String(s.id || `step_${out.length + 1}`), 40)
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_");
        const label = clip(String(s.label || ""), 160);
        if (!label) continue;
        out.push({
            id: id || `step_${out.length + 1}`,
            label,
            detail: s.detail ? clip(String(s.detail), 240) : undefined,
            status,
            confidence: conf,
            actor: s.actor ? clip(String(s.actor), 24) : undefined,
            channel: s.channel ? clip(String(s.channel), 24) : undefined,
        });
        if (out.length >= 10) break;
    }
    return out;
}

/**
 * Smarter LLM plan. Falls back to deterministic on any failure / timeout.
 */
export async function buildOpsCoursePlan(
    openai: OpenAI | null,
    signals: OpsCourseSignals,
    opts: { model?: string; timeoutMs?: number } = {}
): Promise<OpsCoursePlan> {
    const fallback = buildOpsCourseDeterministic(signals);
    if (!openai || process.env.AI_OPS_COURSE_LLM === "0") return fallback;

    const model = opts.model || process.env.AI_MESSAGING_MODEL || "gpt-4.1";
    const timeoutMs = opts.timeoutMs ?? 9000;

    const system = [
        "You plan the course of action a short-term rental guest-relations rep would take next.",
        "Return STRICT JSON only:",
        '{',
        '  "title": "short headline",',
        '  "planSummary": "1-2 sentences",',
        '  "overallConfidence": 0.0,',
        '  "steps": [',
        '    {"id":"snake_case","label":"what to do","detail":"optional","confidence":0.0,"status":"recommended|optional|blocked|guess","actor":"guest|owner|vendor|cleaner|rep|system|unknown","channel":"hostify|quo|internal|null"}',
        "  ]",
        "}",
        "Rules:",
        "- Cover anything a rep might do: reply/follow up guest, owner, vendor/contractor, cleaner; update ticket status; notify other reps; verify billing/calendar/codes.",
        "- If unsure, still include a guess step with confidence <= 0.4 and status=guess. Never return an empty steps list.",
        "- Do NOT claim work is already done. Prefer 'follow up' / 'verify' / 'update ticket'.",
        "- Keep 3-8 steps. Guest reply first when a reply is needed.",
        "- Accept/execution is disabled — these are preview plans for a human (Anj) to overview.",
    ].join("\n");

    const user = [
        `Guest: ${signals.guestName || "unknown"}`,
        `Listing: ${signals.listingName || "unknown"}`,
        `Reservation status: ${signals.reservationStatus || "unknown"}`,
        `Guest message: ${clip(signals.guestText, 1200)}`,
        signals.draftReply ? `AI draft reply: ${clip(signals.draftReply, 600)}` : null,
        signals.escalationRequired
            ? `Escalation required: ${signals.escalationReason || "yes"}`
            : null,
        (signals.suggestedActionItems || []).length
            ? `Suggested action items: ${signals.suggestedActionItems!.slice(0, 6).join(" | ")}`
            : null,
        (signals.warnings || []).length
            ? `Warnings: ${signals.warnings!.slice(0, 4).join(" | ")}`
            : null,
        `Draft confidence: ${signals.confidencePct ?? "?"}%`,
        `Open guest issues: ${signals.openGuestIssueCount ?? "?"}`,
    ]
        .filter(Boolean)
        .join("\n");

    try {
        const completion = await Promise.race([
            openai.chat.completions.create({
                model,
                temperature: 0.2,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]);
        if (!completion) return fallback;
        const raw = completion.choices[0]?.message?.content?.trim() || "";
        const parsed = JSON.parse(raw);
        const steps = normalizeLlmSteps(parsed.steps || parsed.recommendedSteps || []);
        if (!steps.length) return fallback;

        const overall = clamp01(
            Number(parsed.overallConfidence) ||
                steps.reduce((s, x) => s + (x.confidence ?? 0.4), 0) / steps.length
        );

        return {
            title: clip(String(parsed.title || fallback.title), 120),
            planSummary: clip(
                String(parsed.planSummary || fallback.planSummary),
                400
            ),
            evidence: `${fallback.evidence}\nPlanner: llm`,
            proposedReply: fallback.proposedReply,
            taskDescription: fallback.taskDescription,
            overallConfidence: overall,
            recommendedSteps: steps,
            plannedChannels: {
                ...fallback.plannedChannels,
                guest: steps.some((s) => s.actor === "guest") ? "hostify" : fallback.plannedChannels.guest,
                vendor: steps.some((s) => s.actor === "vendor") ? "quo" : fallback.plannedChannels.vendor,
                owner: steps.some((s) => s.actor === "owner") ? "quo" : fallback.plannedChannels.owner,
            },
        };
    } catch {
        return fallback;
    }
}
