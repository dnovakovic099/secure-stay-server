/**
 * Typed memory writes and the staff-only precedent block.
 *
 * `ai_learned_facts` used to hold exactly one kind of thing: a stable Q&A about a
 * property. This service writes the other three kinds — patterns about owners and
 * employees, and the decisions humans made and why — and renders the decision
 * history back into the prompt so the assistant stays consistent with a past
 * refund or exception instead of re-deciding from scratch each time.
 *
 * Nothing written here is quotable to a guest: `AIMemoryPolicy.isGuestUsable`
 * admits only `permanent_fact`, and the retrieval paths enforce it.
 */
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AILearnedFactEntity } from "../entity/AILearnedFact";
import { MemoryType, SubjectType, isExpired, selectRelevant } from "./AIMemoryPolicy";

export type DecisionInput = {
    /** What the decision was about, e.g. "refund", "late-checkout-exception". */
    topic: string;
    /** The call itself, in one line: "Refunded one night, $154.50". */
    decision: string;
    /** Why — the part that makes it reusable as precedent. */
    rationale: string;
    listingId?: number | null;
    subjectType?: SubjectType;
    subjectId?: string | null;
    decidedByUserId?: number | null;
};

export type PatternInput = {
    topic: string;
    /** The observed regularity: "rejects discount requests". */
    pattern: string;
    subjectType: SubjectType;
    subjectId: string;
    listingId?: number | null;
    createdByUserId?: number | null;
};

/**
 * Format decisions for the prompt. Pure so it can be exercised without a
 * database — see src/scripts/evalMemoryPolicy.ts.
 */
export function renderPrecedentLines(
    rows: Array<Pick<AILearnedFactEntity, "topic" | "answer" | "decisionRationale" | "createdAt">>
): string[] {
    const lines: string[] = [];
    for (const r of rows) {
        const what = String(r.answer || r.topic || "").replace(/\s+/g, " ").trim();
        if (!what) continue;
        const why = String(r.decisionRationale || "").replace(/\s+/g, " ").trim();
        const when = String(r.createdAt || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "";
        lines.push(
            `- ${when ? `[${when}] ` : ""}${what.slice(0, 200)}${why ? ` — reason: ${why.slice(0, 200)}` : ""}`
        );
    }
    return lines;
}

export class AIMemoryService {
    private repo = appDatabase.getRepository(AILearnedFactEntity);

    /**
     * Record a decision a human made. Approved on write: a human already made the
     * call, so there is nothing for a reviewer to validate.
     */
    async recordDecision(input: DecisionInput): Promise<AILearnedFactEntity | null> {
        const decision = String(input.decision || "").trim();
        const topic = String(input.topic || "").trim();
        if (!decision || !topic) return null;
        try {
            const row = this.repo.create({
                scope: input.listingId != null ? "property" : "portfolio",
                listingId: input.listingId ?? null,
                topic: topic.slice(0, 120),
                factType: "qa",
                memoryType: "decision" as MemoryType,
                subjectType: input.subjectType || "property",
                subjectId: input.subjectId ?? null,
                // Staff-only: precedent informs behaviour, it is never an answer.
                visibility: "internal",
                question: null,
                answer: decision.slice(0, 2000),
                decisionRationale: String(input.rationale || "").trim().slice(0, 2000) || null,
                status: "approved",
                source: "manual",
                createdByUserId: input.decidedByUserId ?? null,
                lastSeenAt: new Date(),
            });
            return await this.repo.save(row);
        } catch (err: any) {
            logger.warn(`[AIMemory] recordDecision failed: ${err?.message}`);
            return null;
        }
    }

    /**
     * Record an observed pattern about an owner, employee, guest, or vendor.
     * Repeat observations increment `frequency` and refresh `lastSeenAt` rather
     * than inserting duplicates, so repetition is what earns a pattern trust.
     */
    async recordPattern(input: PatternInput): Promise<AILearnedFactEntity | null> {
        const pattern = String(input.pattern || "").trim();
        const topic = String(input.topic || "").trim();
        if (!pattern || !topic || !input.subjectId) return null;
        try {
            const existing = await this.repo.findOne({
                where: {
                    memoryType: "learned_pattern",
                    subjectType: input.subjectType,
                    subjectId: String(input.subjectId),
                    topic: topic.slice(0, 120),
                },
            });
            if (existing) {
                existing.frequency = (Number(existing.frequency) || 1) + 1;
                existing.lastSeenAt = new Date();
                if (!existing.answer) existing.answer = pattern.slice(0, 2000);
                return await this.repo.save(existing);
            }
            const row = this.repo.create({
                scope: input.listingId != null ? "property" : "portfolio",
                listingId: input.listingId ?? null,
                topic: topic.slice(0, 120),
                factType: "qa",
                memoryType: "learned_pattern" as MemoryType,
                subjectType: input.subjectType,
                subjectId: String(input.subjectId).slice(0, 128),
                visibility: "internal",
                answer: pattern.slice(0, 2000),
                // Patterns are inferences. They wait for review unless a human
                // stated them outright, which callers signal by pre-approving.
                status: input.createdByUserId != null ? "approved" : "pending",
                source: input.createdByUserId != null ? "manual" : "nightly_audit",
                createdByUserId: input.createdByUserId ?? null,
                frequency: 1,
                lastSeenAt: new Date(),
            });
            return await this.repo.save(row);
        } catch (err: any) {
            logger.warn(`[AIMemory] recordPattern failed: ${err?.message}`);
            return null;
        }
    }

    /**
     * Staff-only block of past decisions and observed patterns relevant to this
     * conversation. Gives the assistant precedent to defer to, so it stops
     * treating every exception request as the first one ever asked.
     */
    async renderMemoryContext(
        listingIds: number[],
        guestQuery: string,
        subjects: Array<{ type: SubjectType; id: string }> = []
    ): Promise<string | null> {
        const ids = (listingIds || []).map(Number).filter((n) => Number.isFinite(n));
        if (!ids.length && !subjects.length) return null;
        try {
            const where: string[] = [];
            const params: any[] = [];
            if (ids.length) {
                where.push(`(listingId IN (${ids.map(() => "?").join(",")}))`);
                params.push(...ids);
            }
            for (const s of subjects) {
                where.push("(subjectType = ? AND subjectId = ?)");
                params.push(s.type, String(s.id));
            }
            const rows: AILearnedFactEntity[] = await appDatabase.query(
                `SELECT * FROM ai_learned_facts
                 WHERE status = 'approved'
                   AND memoryType IN ('decision','learned_pattern')
                   AND supersededByFactId IS NULL
                   AND (${where.join(" OR ")})
                 ORDER BY COALESCE(lastSeenAt, createdAt) DESC
                 LIMIT 60`,
                params
            );
            if (!rows.length) return null;

            const live = rows.filter((r) => !isExpired(r as any));
            const decisions = selectRelevant(
                live.filter((r) => r.memoryType === "decision"),
                {
                    limit: 5,
                    query: guestQuery,
                    record: (r) => r as any,
                    haystack: (r) => `${r.topic || ""} ${r.answer || ""} ${r.decisionRationale || ""}`,
                }
            );
            const patterns = selectRelevant(
                live.filter((r) => r.memoryType === "learned_pattern"),
                {
                    limit: 5,
                    query: guestQuery,
                    record: (r) => r as any,
                    haystack: (r) => `${r.topic || ""} ${r.answer || ""}`,
                }
            );
            if (!decisions.length && !patterns.length) return null;

            const out: string[] = [
                "## Precedent and known patterns (STAFF-ONLY — never quote, never mention to the guest)",
                "Use these to stay consistent with what the team has already decided. They do NOT authorise you to grant anything: a past approval for someone else is not an approval for this guest.",
            ];
            if (decisions.length) {
                out.push("Past decisions on this property:");
                out.push(...renderPrecedentLines(decisions));
            }
            if (patterns.length) {
                out.push("Observed patterns:");
                for (const p of patterns) {
                    const text = String(p.answer || p.topic || "").replace(/\s+/g, " ").trim();
                    if (!text) continue;
                    out.push(`- ${p.subjectType}: ${text.slice(0, 180)} (seen ${Number(p.frequency) || 1}x)`);
                }
            }
            return out.join("\n");
        } catch (err: any) {
            logger.warn(`[AIMemory] renderMemoryContext failed: ${err?.message}`);
            return null;
        }
    }
}
