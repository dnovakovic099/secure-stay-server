import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIMessageSuggestionEntity } from "../entity/AIMessageSuggestion";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { QuoMessageEntity } from "../entity/QuoMessage";
import { AILearnedFactsService } from "./AILearnedFactsService";
import { ExemplarService } from "./ExemplarService";
import { RetrievalService } from "./RetrievalService";
import { ListingKnowledgeSeeder } from "./ListingKnowledgeSeeder";

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
    private quoMessageRepo = appDatabase.getRepository(QuoMessageEntity);
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

    /** Reply-quality judging uses the full model: mini was too lenient (July audit). */
    private get judgeModel(): string {
        return process.env.AI_JUDGE_MODEL || "gpt-4.1";
    }

    // -------------------------------------------------------------------------
    // 1) Capture what the team actually replied, and score the divergence.
    // -------------------------------------------------------------------------
    async captureActualReplies(sinceDays = 21): Promise<{ scanned: number; matched: number }> {
        const since = new Date();
        since.setDate(since.getDate() - sinceDays);

        // Newest first: unmatched rows stay NULL and are rescanned nightly, so
        // once the 21-day backlog exceeds the cap, ASC ordering starved the
        // newest suggestions (Quo showed 6 paired replies while ~170 pairable
        // rows sat beyond the cutoff). Old never-answered rows age out anyway.
        const suggestions = await this.suggestionRepo
            .createQueryBuilder("s")
            .where("s.generatedAt >= :since", { since })
            .andWhere("s.actualReplyText IS NULL")
            .orderBy("s.generatedAt", "DESC")
            .take(2000)
            .getMany();

        let matched = 0;
        const newlyMatched: AIMessageSuggestionEntity[] = [];
        for (const s of suggestions) {
            try {
                const reply = await this.findTeamReply(s);

                s.auditedAt = new Date();
                if (reply && reply.body && reply.body.trim()) {
                    s.actualReplyText = reply.body;
                    s.actualReplyMessageId = reply.externalId ?? null;
                    s.actualReplyAt = reply.sentAt ?? null;
                    s.replySimilarity = this.similarityPct(s.suggestedReply || "", reply.body);
                    s.auditMatchQuality = await this.assessMatchQuality(s, reply.sentAt);
                    matched++;
                    newlyMatched.push(s);
                }
                await this.suggestionRepo.save(s);
            } catch (err: any) {
                logger.warn(`[InboxAIAudit] capture failed for suggestion ${s.id}: ${err.message}`);
            }
        }
        // Semantic score for the just-matched pairs (batched, best-effort).
        await this.scoreSemantic(newlyMatched).catch((e) =>
            logger.warn(`[InboxAIAudit] semantic scoring failed: ${e.message}`)
        );
        // Judge whether the team reply actually answered the guest (best-effort).
        await this.judgeRelevance(newlyMatched).catch((e) =>
            logger.warn(`[InboxAIAudit] relevance judging failed: ${e.message}`)
        );
        logger.info(`[InboxAIAudit] reply capture: scanned=${suggestions.length} matched=${matched}`);
        return { scanned: suggestions.length, matched };
    }

    /**
     * First human team reply sent after the suggestion was generated —
     * source-aware: Hostify suggestions pair with inbox_messages, Quo (SMS)
     * suggestions pair with quo_messages on the same OpenPhone conversation.
     */
    private async findTeamReply(
        s: AIMessageSuggestionEntity
    ): Promise<{ body: string | null; externalId: number | null; sentAt: Date | null } | null> {
        if (s.source === "quo") {
            if (!s.quoConversationId) return null;
            // Anchor on the guest message time, not generatedAt: shadow drafts are
            // often generated AFTER the team already texted back (debounce race /
            // catch-up sweep), and those replies must still pair up.
            let anchor: Date = s.generatedAt;
            if (s.messageId != null) {
                const gm = await this.quoMessageRepo
                    .findOne({ where: { id: Number(s.messageId) } })
                    .catch(() => null);
                if (gm?.sentAt) anchor = gm.sentAt;
            }
            const m = await this.quoMessageRepo
                .createQueryBuilder("m")
                .where("m.conversationId = :cid", { cid: s.quoConversationId })
                .andWhere("m.direction = :dir", { dir: "outgoing" })
                .andWhere("m.sentAt > :anchor", { anchor })
                // AI auto-sent replies are not "the team's reply" — pairing a
                // suggestion with itself would fake a 100% similarity score.
                .andWhere("(m.senderName IS NULL OR m.senderName != :ai)", { ai: "SecureStay AI" })
                .orderBy("m.sentAt", "ASC")
                .getOne();
            return m ? { body: m.body, externalId: m.id, sentAt: m.sentAt } : null;
        }
        const m = await this.messageRepo
            .createQueryBuilder("m")
            .where("m.threadId = :tid", { tid: s.threadId })
            .andWhere("m.direction = :dir", { dir: "outgoing" })
            .andWhere("m.isAutomatic = 0")
            .andWhere("m.sentAt > :genAt", { genAt: s.generatedAt })
            .orderBy("m.sentAt", "ASC")
            .getOne();
        return m ? { body: m.body, externalId: m.externalId ?? null, sentAt: m.sentAt ?? null } : null;
    }

    /** Body of the guest message the suggestion was drafted against (source-aware). */
    private async findGuestMessageBody(s: AIMessageSuggestionEntity): Promise<string> {
        if (s.messageId == null) return "";
        try {
            if (s.source === "quo") {
                const gm = await this.quoMessageRepo.findOne({ where: { id: Number(s.messageId) } });
                return (gm?.body || "").replace(/\s+/g, " ").trim();
            }
            const gm = await this.messageRepo
                .createQueryBuilder("m")
                .where("m.threadId = :tid", { tid: s.threadId })
                .andWhere("m.externalId = :eid", { eid: s.messageId })
                .getOne();
            return (gm?.body || "").replace(/\s+/g, " ").trim();
        } catch {
            return "";
        }
    }

    /**
     * Decide whether the AI suggestion and the team's reply are answering the SAME
     * guest message. The team replies to whatever the LATEST inbound message was
     * just before they sent. If that isn't the message the AI drafted against
     * (s.messageId), the guest sent a follow-up first and the two replies are about
     * different things — so the similarity is meaningless. Returns:
     *   "clean" | "guest_followup" | "unknown"
     */
    private async assessMatchQuality(
        s: AIMessageSuggestionEntity,
        replyAt: Date | null
    ): Promise<string> {
        if (!replyAt || s.messageId == null) return "unknown";
        try {
            if (s.source === "quo") {
                if (!s.quoConversationId) return "unknown";
                const latest = await this.quoMessageRepo
                    .createQueryBuilder("m")
                    .where("m.conversationId = :cid", { cid: s.quoConversationId })
                    .andWhere("m.direction = :dir", { dir: "incoming" })
                    .andWhere("m.sentAt < :r", { r: replyAt })
                    .orderBy("m.sentAt", "DESC")
                    .getOne();
                if (!latest) return "unknown";
                return Number(latest.id) === Number(s.messageId) ? "clean" : "guest_followup";
            }
            const latestInbound = await this.messageRepo
                .createQueryBuilder("m")
                .where("m.threadId = :tid", { tid: s.threadId })
                .andWhere("m.direction = :dir", { dir: "incoming" })
                .andWhere("m.sentAt < :r", { r: replyAt })
                .orderBy("m.sentAt", "DESC")
                .getOne();
            if (!latestInbound || latestInbound.externalId == null) return "unknown";
            return Number(latestInbound.externalId) === Number(s.messageId) ? "clean" : "guest_followup";
        } catch {
            return "unknown";
        }
    }

    /**
     * Backfill auditMatchQuality for previously-matched pairs that predate the flag.
     * Bounded; runs nightly so history classifies itself over a few nights.
     */
    async backfillMatchQuality(limit = 1000): Promise<{ backfilled: number }> {
        const rows = await this.suggestionRepo
            .createQueryBuilder("s")
            .where("s.actualReplyText IS NOT NULL AND s.actualReplyText <> ''")
            .andWhere("s.actualReplyAt IS NOT NULL")
            .andWhere("s.auditMatchQuality IS NULL")
            .orderBy("s.generatedAt", "DESC")
            .take(Math.min(Math.max(limit, 1), 3000))
            .getMany();
        if (!rows.length) return { backfilled: 0 };
        for (const s of rows) {
            s.auditMatchQuality = await this.assessMatchQuality(s, s.actualReplyAt);
        }
        await this.suggestionRepo.save(rows);
        logger.info(`[InboxAIAudit] match-quality backfill: ${rows.length} pairs`);
        return { backfilled: rows.length };
    }

    // -------------------------------------------------------------------------
    // Relevance judging: did the team's reply actually ANSWER the guest?
    // -------------------------------------------------------------------------

    /**
     * LLM-judge whether each captured team reply actually addresses the guest's
     * message. Team replies that are off-topic (e.g. "we'll call your phone"
     * when the guest asked about parking — driven by internal context the AI
     * can't know) are tagged "off_topic": excluded from quality scores but kept
     * and listed on Analytics as "not valid for scoring". Best-effort; failures
     * leave replyRelevance NULL for a later retry.
     */
    async judgeRelevance(rows: AIMessageSuggestionEntity[]): Promise<number> {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!rows.length || !apiKey) return 0;
        const openai = new OpenAI({ apiKey });

        // Look up the guest message each suggestion was drafted against.
        const items: { row: AIMessageSuggestionEntity; guestMsg: string }[] = [];
        const skipped: AIMessageSuggestionEntity[] = [];
        for (const s of rows) {
            if (!s.actualReplyText || !s.actualReplyText.trim()) continue;
            // Follow-up pairs are already excluded from scoring; don't spend tokens.
            if (s.auditMatchQuality === "guest_followup") {
                s.replyRelevance = "unknown";
                s.aiReplyQuality = "unknown";
                skipped.push(s);
                continue;
            }
            const guestMsg = await this.findGuestMessageBody(s);
            if (!guestMsg) {
                s.replyRelevance = "unknown";
                s.aiReplyQuality = "unknown";
                skipped.push(s);
                continue;
            }
            items.push({ row: s, guestMsg });
        }
        if (skipped.length) await this.suggestionRepo.save(skipped);

        const system = [
            "You review short-term-rental guest messaging quality data.",
            "For each item you get the GUEST's message, the AI's suggested reply, and the reply a human TEAM member actually sent.",
            "Judge TWO things independently:",
            "1) verdict — does the TEAM reply address the guest's message?",
            '- "relevant": it answers, partially answers, asks a clarifying question about, or directly acknowledges the guest\'s topic.',
            '- "off_topic": it is about something unrelated or driven by internal operations the guest did not ask about (e.g. guest asks about parking and the team says "our property manager will call your phone", a payment-verification link, an upsell pitch, or a question about a completely different subject).',
            '- "unknown": you cannot tell.',
            'For "off_topic" include a short note (max 15 words) saying what the team reply was actually about.',
            "2) ai_verdict — STRICT, CALIBRATED judgement of the AI reply on its own. Ask: would a fair property manager call this reply a genuine mistake if it had been sent as-is?",
            "CRITICAL SCOPE RULE: judge the AI ONLY against the GUEST's message shown. The team often answers OTHER questions from earlier/later messages, gives unprompted status updates, or acts on internal operational knowledge (a reservation change already processed, maintenance already scheduled, a payment/deposit event, who will call whom). None of that counts against the AI — an ask or issue that appears ONLY in the team's reply and not in the guest's message shown must be ignored.",
            "Concretely: when the guest asks about the STATUS of a pending request (a date change, a refund, a repair, an approval), the AI cannot know the live status. If the AI gave a safe, plausible path forward (e.g. 'you can book it in the app', 'the team is finalizing it') while the team simply knew the outcome ('you're all set, it's confirmed'), that is \"addressed\" — NOT a miss, NOT a deferral. Only mark such a case \"missed\" if the AI asserted a status as fact that the team contradicted.",
            '- "missed" (a genuine mistake) when ANY of these apply:',
            "  * wrong info: the AI stated something factually contradicted by the team reply (price, rule, amenity, address, code, availability) — only for stable facts, not one-off internal statuses the AI could not know. \"Contradicted\" requires the team to state a SPECIFIC, UNCONDITIONAL different fact.",
            "AVAILABILITY RULE (important): the AI has DIRECT access to the live booking calendar — giving a definitive availability answer (dates open/booked, nightly prices) is correct, desired behavior, never overreach. When the guest asks about availability/extensions, do NOT mark \"missed\" because the team deferred ('I'll check with the team'), pointed the guest to the platform, or made a CONDITIONAL statement ('if the platform lets you select those dates, they're available'). None of those contradict the AI. Only mark wrong_info if the team states a specific opposite fact outright (e.g. 'that night is actually open, I've added it').",
            "  * needless deferral: the guest asked for something concrete and the AI said it would check / escalate / follow up while the team answered directly with the substance. Politeness does not excuse it. EXCEPTION: if answering required internal/live operational status (has a request been processed? is maintenance booked?), deferring was correct.",
            "  * ignored ask: the AI skipped an explicit question or request IN THE GUEST'S MESSAGE SHOWN (including PART of a multi-part message) that the team addressed. Asks visible only in the team reply do NOT count.",
            '- "addressed" (acceptable) when the reply was safe and reasonable to send as-is. Differences that are ONLY: shorter/longer wording, extra warmth, missing internal-ops details the AI could not know, the team answering additional questions the guest asked elsewhere, or the team volunteering unrelated extras — are acceptable, NOT mistakes.',
            '- "unknown": you cannot tell.',
            'For "missed" ALSO include:',
            '- ai_note: one short sentence (max 20 words) saying exactly what the AI failed to provide or got wrong.',
            "- ai_category: the failure type —",
            '  "wrong_info" = the AI stated something incorrect (fix: correct the knowledge base);',
            '  "deferral" = needless deferral/escalation when it could and should have answered;',
            '  "ignored_ask" = skipped an explicit (part of the) guest request;',
            '  "missing_info" = the AI lacked a STABLE property/policy fact the team knew (amenity, rule, fee, code, instructions — something a knowledge base could hold; NOT reservation status or ops state);',
            '  "other" = anything else.',
            'Respond with STRICT JSON only: {"results":[{"i":<index>,"verdict":"relevant|off_topic|unknown","ai_verdict":"addressed|missed|unknown","note":"...","ai_note":"...","ai_category":"wrong_info|deferral|ignored_ask|missing_info|other"}]}',
        ].join("\n");

        let judged = 0;
        for (let start = 0; start < items.length; start += 15) {
            const batch = items.slice(start, start + 15);
            const user = batch
                .map(
                    (it, i) =>
                        `#${i}\nGUEST: ${it.guestMsg.slice(0, 400)}\nAI REPLY: ${(it.row.suggestedReply || "")
                            .replace(/\s+/g, " ")
                            .slice(0, 400)}\nTEAM REPLY: ${(it.row.actualReplyText || "")
                            .replace(/\s+/g, " ")
                            .slice(0, 400)}`
                )
                .join("\n\n");
            try {
                const resp = await openai.chat.completions.create({
                    model: this.judgeModel,
                    temperature: 0,
                    response_format: { type: "json_object" },
                    messages: [
                        { role: "system", content: system },
                        { role: "user", content: user },
                    ],
                });
                const parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
                const results: any[] = Array.isArray(parsed?.results) ? parsed.results : [];
                for (const r of results) {
                    const it = batch[Number(r?.i)];
                    if (!it) continue;
                    const v = String(r?.verdict || "").toLowerCase();
                    it.row.replyRelevance = v === "relevant" || v === "off_topic" ? v : "unknown";
                    it.row.replyRelevanceNote =
                        v === "off_topic" && r?.note ? String(r.note).slice(0, 255) : null;
                    const av = String(r?.ai_verdict || "").toLowerCase();
                    it.row.aiReplyQuality = av === "addressed" || av === "missed" ? av : "unknown";
                    if (av === "missed") {
                        it.row.aiReplyQualityNote = r?.ai_note ? String(r.ai_note).slice(0, 255) : null;
                        const cat = String(r?.ai_category || "").toLowerCase();
                        it.row.aiReplyQualityCategory = ["missing_info", "wrong_info", "deferral", "ignored_ask"].includes(cat)
                            ? cat
                            : "other";
                    } else {
                        it.row.aiReplyQualityNote = null;
                        it.row.aiReplyQualityCategory = null;
                    }
                    judged++;
                }
                // Anything the model skipped: mark unknown so backfill doesn't loop on it.
                for (const it of batch) {
                    if (!it.row.replyRelevance) it.row.replyRelevance = "unknown";
                    if (!it.row.aiReplyQuality) it.row.aiReplyQuality = "unknown";
                }
                // Persist per batch so progress survives an interrupted long run.
                await this.suggestionRepo.save(batch.map((it) => it.row));
            } catch (err: any) {
                logger.warn(`[InboxAIAudit] relevance judge batch failed: ${err.message}`);
            }
        }
        return judged;
    }

    /**
     * Backfill replyRelevance for historical matched pairs. Bounded per run so
     * the nightly job classifies history over a few nights.
     */
    async backfillRelevance(limit = 300): Promise<{ backfilled: number }> {
        if (!process.env.OPENAI_API_KEY) return { backfilled: 0 };
        const rows = await this.suggestionRepo
            .createQueryBuilder("s")
            .where("s.actualReplyText IS NOT NULL AND s.actualReplyText <> ''")
            .andWhere("s.suggestedReply IS NOT NULL AND s.suggestedReply <> ''")
            .andWhere(
                // Unjudged rows, plus already-judged misses that predate the
                // note/category fields (re-judged once to populate the fix queue).
                "(s.replyRelevance IS NULL OR s.aiReplyQuality IS NULL OR (s.aiReplyQuality = 'missed' AND s.aiReplyQualityCategory IS NULL))"
            )
            .orderBy("s.generatedAt", "DESC")
            .take(Math.min(Math.max(limit, 1), 1000))
            .getMany();
        if (!rows.length) return { backfilled: 0 };
        await this.judgeRelevance(rows);
        logger.info(`[InboxAIAudit] relevance backfill: ${rows.length} pairs`);
        return { backfilled: rows.length };
    }

    /**
     * Compute embedding-cosine similarity (0..100) between each suggestion and the
     * team's actual reply, in batches, and persist to replySemanticSimilarity.
     * Jaccard token-overlap (replySimilarity) badly understates agreement because
     * the team writes far shorter replies; the semantic score is what the Analytics
     * page trends on. Skipped silently if OPENAI_API_KEY is absent.
     */
    private async scoreSemantic(rows: AIMessageSuggestionEntity[]): Promise<void> {
        if (!rows.length || !process.env.OPENAI_API_KEY) return;
        const { EmbeddingService } = await import("./EmbeddingService");
        const es = new EmbeddingService();

        // Whole-reply semantic (style-sensitive, kept as a secondary signal).
        const aiVecs = await es.embedMany(rows.map((r) => r.suggestedReply || ""));
        const teamVecs = await es.embedMany(rows.map((r) => r.actualReplyText || ""));

        // Sentence-level embeddings for coverage (the length-invariant north-star).
        const aiSentsPer = rows.map((r) => this.splitSentences(r.suggestedReply || ""));
        const teamSentsPer = rows.map((r) => this.splitSentences(r.actualReplyText || ""));
        const flat: string[] = [];
        aiSentsPer.forEach((arr) => arr.forEach((s) => flat.push(s)));
        teamSentsPer.forEach((arr) => arr.forEach((s) => flat.push(s)));
        const sentVecs = flat.length ? await es.embedMany(flat) : [];
        let pos = 0;
        const aiVecsPer = aiSentsPer.map((arr) => arr.map(() => sentVecs[pos++]));
        const teamVecsPer = teamSentsPer.map((arr) => arr.map(() => sentVecs[pos++]));

        for (let i = 0; i < rows.length; i++) {
            const sem = EmbeddingService.cosine(aiVecs[i], teamVecs[i]) * 100;
            rows[i].replySemanticSimilarity = Math.round(sem * 100) / 100;

            // Coverage = for each substantive sentence the TEAM said, how well does
            // the AI reply cover it (best matching AI sentence)? Extra AI verbosity
            // does not lower the score, so it isolates substance from length.
            const tvs = teamVecsPer[i];
            const avs = aiVecsPer[i];
            if (!tvs.length) {
                // Team reply had no substantive content (pure ack/emoji). Store -1 as
                // a "scored, not applicable" sentinel — NULL would make the backfill
                // reprocess these rows forever. Readers treat negatives as null.
                rows[i].replyCoverageScore = -1;
            } else if (!avs.length) {
                rows[i].replyCoverageScore = 0;
            } else {
                let sum = 0;
                for (const tv of tvs) {
                    let mx = 0;
                    for (const av of avs) mx = Math.max(mx, EmbeddingService.cosine(tv, av));
                    sum += Math.max(0, mx);
                }
                rows[i].replyCoverageScore = Math.round((sum / tvs.length) * 10000) / 100;
            }
        }
        await this.suggestionRepo.save(rows);
    }

    /**
     * Split a reply into substantive sentences for coverage scoring. Drops greetings
     * and tiny fragments so the metric focuses on real informational content.
     */
    private splitSentences(text: string): string[] {
        return String(text || "")
            .replace(/\s+/g, " ")
            .split(/(?<=[.!?])\s+|\n+/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 12 && s.split(/\s+/).length >= 3);
    }

    /**
     * Backfill semantic similarity for historical matched pairs that predate the
     * column (or were captured before scoring existed). Bounded per run so the
     * nightly job fills history over a few nights without a manual script.
     */
    async backfillSemantic(limit = 400): Promise<{ backfilled: number }> {
        if (!process.env.OPENAI_API_KEY) return { backfilled: 0 };
        const rows = await this.suggestionRepo
            .createQueryBuilder("s")
            .where("s.actualReplyText IS NOT NULL AND s.actualReplyText <> ''")
            .andWhere("s.suggestedReply IS NOT NULL AND s.suggestedReply <> ''")
            .andWhere("(s.replySemanticSimilarity IS NULL OR s.replyCoverageScore IS NULL)")
            .orderBy("s.generatedAt", "DESC")
            .take(Math.min(Math.max(limit, 1), 1000))
            .getMany();
        if (!rows.length) return { backfilled: 0 };
        // Chunk so a single embed request stays reasonable.
        let done = 0;
        for (let i = 0; i < rows.length; i += 60) {
            const chunk = rows.slice(i, i + 60);
            await this.scoreSemantic(chunk).catch((e) =>
                logger.warn(`[InboxAIAudit] backfill chunk failed: ${e.message}`)
            );
            done += chunk.length;
        }
        logger.info(`[InboxAIAudit] semantic+coverage backfill: ${done} pairs`);
        return { backfilled: done };
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

        // Targeted learning: put listings where the AI recently diverged most from
        // the team (low answer-coverage pairs) at the FRONT of the queue, so every
        // divergence becomes a learning opportunity instead of just a metric.
        try {
            const struggling: any[] = await appDatabase.query(
                `SELECT listingId, COUNT(*) cnt FROM ai_message_suggestions
                 WHERE replyCoverageScore >= 0 AND replyCoverageScore < 50
                   AND (auditMatchQuality IS NULL OR auditMatchQuality <> 'guest_followup')
                   AND generatedAt >= ? AND listingId IS NOT NULL
                 GROUP BY listingId ORDER BY cnt DESC LIMIT 10`,
                [since]
            );
            const seen = new Set(busy.map((b: any) => Number(b.listingId)));
            const priority = struggling
                .filter((r) => !seen.has(Number(r.listingId)))
                .map((r) => ({ listingId: r.listingId, cnt: minMessages }));
            // Low-coverage listings already in the busy list move to the front.
            const strugglingIds = new Set(struggling.map((r) => Number(r.listingId)));
            busy.sort(
                (a: any, b: any) =>
                    Number(strugglingIds.has(Number(b.listingId))) - Number(strugglingIds.has(Number(a.listingId)))
            );
            busy.unshift(...priority);
            if (priority.length || strugglingIds.size) {
                logger.info(
                    `[InboxAIAudit] extraction prioritizing ${strugglingIds.size} low-coverage listing(s) (${priority.length} added)`
                );
            }
        } catch {
            /* best-effort prioritization */
        }

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
                    try {
                        await this.learned.upsert(
                            { scope: "property", listingId, topic: f.topic, question: f.question, answer: f.answer },
                            { autoApprove }
                        );
                        factsUpserted++;
                    } catch (e: any) {
                        logger.warn(`[InboxAIAudit] skipped fact "${f.topic}": ${e.message}`);
                    }
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
                        try {
                            await this.learned.upsert(
                                { scope: "portfolio", listingId: null, topic: f.topic, question: f.question, answer: f.answer },
                                { autoApprove }
                            );
                            factsUpserted++;
                        } catch (e: any) {
                            logger.warn(`[InboxAIAudit] skipped portfolio fact "${f.topic}": ${e.message}`);
                        }
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
            "- PRIORITIZE the stable operational policies the team repeats to guests: check-in/checkout times, early check-in / late checkout availability & fee, luggage drop-off, parking, pet policy, quiet hours, and the general cancellation/refund POLICY (the standing rule, e.g. 'no refund for shortened stays'), plus the check-in/access PROCESS (how codes/instructions are sent) WITHOUT the actual code value.",
            "- EXCLUDE volatile or sensitive specifics: door/lock/gate codes, wifi passwords, exact nightly room rates, one-off dates, personal guest data, and ONE-OFF refund/discount DECISIONS made for a single guest (a standing refund POLICY is fine; a specific 'we refunded you $X' is not). Service fees that are standard and repeated (e.g. early check-in fee, pet fee) ARE allowed.",
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

        // Fill semantic scores for historical matched pairs (bounded per night).
        const semBf = await this.backfillSemantic().catch((e) => {
            logger.error(`[InboxAIAudit] semantic backfill failed: ${e.message}`);
            return { backfilled: 0 };
        });

        // Classify historical pairs as comparable vs guest-followup (bounded).
        const mqBf = await this.backfillMatchQuality().catch((e) => {
            logger.error(`[InboxAIAudit] match-quality backfill failed: ${e.message}`);
            return { backfilled: 0 };
        });

        // Judge team-reply relevance for historical pairs (bounded).
        const relBf = await this.backfillRelevance().catch((e) => {
            logger.error(`[InboxAIAudit] relevance backfill failed: ${e.message}`);
            return { backfilled: 0 };
        });

        // Auto-resolve learning prompts whose fact has since been learned.
        const { AILearningPromptService } = await import("./AILearningPromptService");
        const learnRes = await new AILearningPromptService().autoResolveCovered().catch((e) => {
            logger.error(`[InboxAIAudit] learning prompt auto-resolve failed: ${e.message}`);
            return { resolved: 0 };
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

        // Safety net: seed Knowledge Base for any listing that has an inbox
        // conversation but no KB yet (new reservations arrive on fresh Hostify
        // child IDs). Keeps listing grounding complete without manual reseeds.
        const sweep = await new ListingKnowledgeSeeder().sweepMissingConversationKnowledge().catch((e) => {
            logger.error(`[InboxAIAudit] KB sweep failed: ${e.message}`);
            return { scanned: 0, seeded: 0, entries: 0 };
        });

        // Grow the semantic retrieval store from the last few days of new replies,
        // and index any newly-approved learned facts.
        let emb = { pairs: 0, embedded: 0 };
        if (ExemplarService.isEnabled()) {
            emb = await new ExemplarService().backfillFromHistory({ sinceDays: 7 }).catch((e) => {
                logger.error(`[InboxAIAudit] exemplar backfill failed: ${e.message}`);
                return { pairs: 0, embedded: 0 };
            });
            await new RetrievalService().embedFacts().catch((e) => {
                logger.error(`[InboxAIAudit] fact embedding failed: ${e.message}`);
                return 0;
            });
            // Index any new/edited Knowledge Base entries into the semantic store.
            await new RetrievalService().embedKnowledge().catch((e) => {
                logger.error(`[InboxAIAudit] KB embedding failed: ${e.message}`);
                return 0;
            });
        }

        logger.info(
            `[InboxAIAudit] nightly audit complete — replies matched=${cap.matched}/${cap.scanned}, ` +
                `properties=${ext.properties}, pending facts upserted=${ext.factsUpserted}, ` +
                `KB sweep seeded=${sweep.entries} entries/${sweep.seeded} listings, ` +
                `semantic backfilled=${semBf.backfilled}, ` +
                `match-quality backfilled=${mqBf.backfilled}, ` +
                `relevance backfilled=${relBf.backfilled}, ` +
                `learning prompts auto-resolved=${learnRes.resolved}, ` +
                `new exemplars embedded=${emb.embedded}`
        );
    }
}
