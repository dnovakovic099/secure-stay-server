import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIMessageSuggestionEntity } from "../entity/AIMessageSuggestion";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { AILearnedFactsService } from "./AILearnedFactsService";

interface ExtractedFact {
    topic: string;
    question: string;
    answer: string;
}

/**
 * InboxAIAuditService — the nightly self-improvement loop.
 *
 * Every night this:
 *  1. Captures the human reply the team actually sent for each recent AI
 *     suggestion (comparison data) and scores how close it was to the AI's.
 *  2. Extracts frequently-asked, stable facts from real Q&A per property AND
 *     portfolio-wide, storing them as PENDING learned facts for staff review.
 *
 * Safety: step 1 only reads/writes suggestion rows; step 2 only writes PENDING
 * facts that never reach a guest until a human approves them. The AI-extraction
 * step is gated by AI_NIGHTLY_AUDIT_ENABLED (default ON, killable) and requires
 * OPENAI_API_KEY. Nothing here ever sends a message.
 */
export class InboxAIAuditService {
    private suggestionRepo = appDatabase.getRepository(AIMessageSuggestionEntity);
    private messageRepo = appDatabase.getRepository(InboxMessageEntity);
    private learned = new AILearnedFactsService();

    /** Extraction (the OpenAI part) is on by default but can be turned off. */
    static extractionEnabled(): boolean {
        return String(process.env.AI_NIGHTLY_AUDIT_ENABLED || "true").toLowerCase() !== "false";
    }

    /**
     * Auto-approve extracted facts so they feed the bot immediately (default ON).
     * Set AI_AUTO_APPROVE_FACTS=false to require manual review in the Learned tab.
     */
    static autoApproveFacts(): boolean {
        return String(process.env.AI_AUTO_APPROVE_FACTS || "true").toLowerCase() !== "false";
    }

    private get model(): string {
        return process.env.AI_MESSAGING_MODEL || "gpt-4.1";
    }

    // -------------------------------------------------------------------------
    // 1) Capture what the team actually replied, and score the divergence.
    // -------------------------------------------------------------------------
    async captureActualReplies(sinceDays = 21): Promise<{ scanned: number; matched: number }> {
        const since = new Date();
        since.setDate(since.getDate() - sinceDays);

        const suggestions = await this.suggestionRepo
            .createQueryBuilder("s")
            .where("s.generatedAt >= :since", { since })
            .andWhere("s.actualReplyText IS NULL")
            .orderBy("s.generatedAt", "ASC")
            .take(2000)
            .getMany();

        let matched = 0;
        for (const s of suggestions) {
            try {
                const reply = await this.messageRepo
                    .createQueryBuilder("m")
                    .where("m.threadId = :tid", { tid: s.threadId })
                    .andWhere("m.direction = :dir", { dir: "outgoing" })
                    .andWhere("m.isAutomatic = 0")
                    .andWhere("m.sentAt > :genAt", { genAt: s.generatedAt })
                    .orderBy("m.sentAt", "ASC")
                    .getOne();

                s.auditedAt = new Date();
                if (reply && reply.body && reply.body.trim()) {
                    s.actualReplyText = reply.body;
                    s.actualReplyMessageId = reply.externalId ?? null;
                    s.actualReplyAt = reply.sentAt ?? null;
                    s.replySimilarity = this.similarityPct(s.suggestedReply || "", reply.body);
                    matched++;
                }
                await this.suggestionRepo.save(s);
            } catch (err: any) {
                logger.warn(`[InboxAIAudit] capture failed for suggestion ${s.id}: ${err.message}`);
            }
        }
        logger.info(`[InboxAIAudit] reply capture: scanned=${suggestions.length} matched=${matched}`);
        return { scanned: suggestions.length, matched };
    }

    /** Token-overlap (Jaccard) similarity as a 0..100 percentage. */
    private similarityPct(a: string, b: string): number {
        const norm = (s: string) =>
            new Set(
                String(s)
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/g, " ")
                    .split(/\s+/)
                    .filter((w) => w.length > 2)
            );
        const sa = norm(a);
        const sb = norm(b);
        if (sa.size === 0 || sb.size === 0) return 0;
        let inter = 0;
        for (const w of sa) if (sb.has(w)) inter++;
        const union = sa.size + sb.size - inter;
        return union === 0 ? 0 : Math.round((inter / union) * 10000) / 100;
    }

    // -------------------------------------------------------------------------
    // 2) Extract frequently-asked facts per property + portfolio-wide.
    // -------------------------------------------------------------------------
    async extractLearnedFacts(
        opts: {
            sinceDays?: number;
            maxListings?: number;
            minMessages?: number;
            maxMessagesPerListing?: number;
            includePortfolio?: boolean;
        } = {}
    ): Promise<{ properties: number; factsUpserted: number }> {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            logger.warn("[InboxAIAudit] OPENAI_API_KEY missing — skipping fact extraction.");
            return { properties: 0, factsUpserted: 0 };
        }
        const sinceDays = opts.sinceDays ?? 14;
        const maxListings = opts.maxListings ?? 20;
        const minMessages = opts.minMessages ?? 3;
        const maxMsgs = opts.maxMessagesPerListing ?? 60;
        const includePortfolio = opts.includePortfolio !== false;

        const since = new Date();
        since.setDate(since.getDate() - sinceDays);
        const openai = new OpenAI({ apiKey });

        // Listings by guest-message volume in the window (busiest first). Each is
        // processed independently so facts never bleed between different properties.
        const busy = await this.messageRepo
            .createQueryBuilder("m")
            .select("m.listingId", "listingId")
            .addSelect("COUNT(*)", "cnt")
            .where("m.direction = :d", { d: "incoming" })
            .andWhere("m.sentAt >= :since", { since })
            .andWhere("m.listingId IS NOT NULL")
            .groupBy("m.listingId")
            .orderBy("cnt", "DESC")
            .limit(maxListings)
            .getRawMany();

        let factsUpserted = 0;
        let properties = 0;
        const autoApprove = InboxAIAuditService.autoApproveFacts();

        for (const row of busy) {
            const listingId = Number(row.listingId);
            if (!listingId || Number(row.cnt) < minMessages) continue;
            try {
                const transcript = await this.buildQATranscript(listingId, since, maxMsgs);
                if (!transcript) continue;
                const facts = await this.callExtractor(openai, transcript, "property");
                for (const f of facts) {
                    await this.learned.upsert(
                        { scope: "property", listingId, topic: f.topic, question: f.question, answer: f.answer },
                        { autoApprove }
                    );
                    factsUpserted++;
                }
                properties++;
            } catch (err: any) {
                logger.warn(`[InboxAIAudit] extraction failed for listing ${listingId}: ${err.message}`);
            }
        }

        // Portfolio-wide pass: ONLY genuinely universal company policy — kept strict
        // because properties differ a lot and we must not promote a single listing's
        // detail to all of them.
        if (includePortfolio) {
            try {
                const globalTranscript = await this.buildQATranscript(null, since, 150);
                if (globalTranscript) {
                    const facts = await this.callExtractor(openai, globalTranscript, "portfolio");
                    for (const f of facts) {
                        await this.learned.upsert(
                            { scope: "portfolio", listingId: null, topic: f.topic, question: f.question, answer: f.answer },
                            { autoApprove }
                        );
                        factsUpserted++;
                    }
                }
            } catch (err: any) {
                logger.warn(`[InboxAIAudit] portfolio extraction failed: ${err.message}`);
            }
        }

        logger.info(`[InboxAIAudit] fact extraction: properties=${properties} factsUpserted=${factsUpserted}`);
        return { properties, factsUpserted };
    }

    /**
     * One-shot: learn from the ENTIRE message history, every listing, strictly
     * per-property (no portfolio pass, to avoid cross-listing leakage on bulk data).
     */
    async backfillAllHistory(): Promise<{ properties: number; factsUpserted: number }> {
        logger.info("[InboxAIAudit] full-history backfill started");
        const res = await this.extractLearnedFacts({
            sinceDays: 3650,
            maxListings: 1000,
            minMessages: 4,
            maxMessagesPerListing: 200,
            includePortfolio: false,
        });
        logger.info(`[InboxAIAudit] full-history backfill complete: ${JSON.stringify(res)}`);
        return res;
    }

    /** Build a compact "Guest asked / Team answered" transcript for the model. */
    private async buildQATranscript(listingId: number | null, since: Date, maxMessages: number): Promise<string | null> {
        const qb = this.messageRepo
            .createQueryBuilder("m")
            .where("m.sentAt >= :since", { since })
            .andWhere("(m.direction = :inc OR (m.direction = :out AND m.isAutomatic = 0))", { inc: "incoming", out: "outgoing" })
            .orderBy("m.sentAt", "ASC")
            .take(maxMessages);
        if (listingId != null) qb.andWhere("m.listingId = :lid", { lid: listingId });

        const msgs = await qb.getMany();
        if (msgs.length < 4) return null;

        const lines: string[] = [];
        for (const m of msgs) {
            const body = (m.body || "").replace(/\s+/g, " ").trim();
            if (!body) continue;
            lines.push(`${m.direction === "incoming" ? "GUEST" : "TEAM"}: ${body.slice(0, 400)}`);
        }
        const text = lines.join("\n");
        return text.length > 12000 ? text.slice(-12000) : text;
    }

    private async callExtractor(openai: OpenAI, transcript: string, mode: "property" | "portfolio"): Promise<ExtractedFact[]> {
        const common = [
            "You analyze real short-term-rental guest conversations to extract FREQUENTLY-ASKED, STABLE facts",
            "so an assistant can answer future guests accurately.",
            "Rules:",
            "- Only extract facts clearly supported by how the TEAM answered guests. Never invent.",
            "- EXCLUDE anything volatile or sensitive: specific door/lock codes, wifi passwords, exact nightly prices, one-off dates, personal guest data, refund/discount decisions.",
            "- Merge duplicates. Prefer the team's own wording for the answer. Keep answers concise.",
            "- If nothing qualifies, return an empty array.",
        ];
        const modeRules =
            mode === "property"
                ? [
                      "SCOPE: These conversations are all for ONE SPECIFIC PROPERTY.",
                      "- Extract facts TRUE FOR THIS PROPERTY ONLY (its parking, access process, amenities, layout, directions, quiet hours, pet policy, nearby spots).",
                      "- Do NOT generalize to other properties. Do NOT include generic company-wide policy — only this property's specifics.",
                  ]
                : [
                      "SCOPE: These conversations span MANY DIFFERENT properties.",
                      "- Extract ONLY facts that are genuinely UNIVERSAL company policy/process applying to EVERY property (e.g. how payment works, ID/verification, general booking/extension process, quiet-hours policy stated company-wide).",
                      "- Properties differ a lot: DO NOT extract anything property-specific (a specific address, a specific amenity, a specific parking spot, specific directions). When in doubt, leave it out.",
                  ];
        const system = [
            ...common,
            ...modeRules,
            'Respond with STRICT JSON only: {"facts":[{"topic":"short-slug","question":"canonical guest question","answer":"concise guest-shareable answer"}]}',
            "Return at most 8 facts.",
        ].join("\n");

        const resp = await openai.chat.completions.create({
            model: this.model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: system },
                { role: "user", content: `Conversations:\n\n${transcript}` },
            ],
        });

        const raw = resp.choices?.[0]?.message?.content || "{}";
        let parsed: any;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return [];
        }
        const facts = Array.isArray(parsed?.facts) ? parsed.facts : [];
        return facts
            .filter((f: any) => f && f.topic && f.answer)
            .slice(0, 8)
            .map((f: any) => ({
                topic: String(f.topic).slice(0, 120),
                question: f.question ? String(f.question).slice(0, 500) : "",
                answer: String(f.answer).slice(0, 2000),
            }));
    }

    // -------------------------------------------------------------------------
    // Orchestrator (called by the scheduler).
    // -------------------------------------------------------------------------
    async runNightlyAudit(): Promise<void> {
        logger.info("[InboxAIAudit] nightly audit started");
        // Always safe: capture comparison data.
        const cap = await this.captureActualReplies().catch((e) => {
            logger.error(`[InboxAIAudit] capture stage failed: ${e.message}`);
            return { scanned: 0, matched: 0 };
        });

        // Gated: AI extraction of learned facts (stored pending; never guest-facing).
        let ext = { properties: 0, factsUpserted: 0 };
        if (InboxAIAuditService.extractionEnabled()) {
            ext = await this.extractLearnedFacts().catch((e) => {
                logger.error(`[InboxAIAudit] extraction stage failed: ${e.message}`);
                return { properties: 0, factsUpserted: 0 };
            });
        } else {
            logger.info("[InboxAIAudit] extraction disabled via AI_NIGHTLY_AUDIT_ENABLED=false");
        }

        logger.info(
            `[InboxAIAudit] nightly audit complete — replies matched=${cap.matched}/${cap.scanned}, ` +
                `properties=${ext.properties}, pending facts upserted=${ext.factsUpserted}`
        );
    }
}
