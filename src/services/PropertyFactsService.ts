import OpenAI from "openai";
import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { PropertyFactEntity } from "../entity/PropertyFact";
import { PropertyFactProposalEntity } from "../entity/PropertyFactProposal";
import { AIMessageFeedbackEntity } from "../entity/AIMessageFeedback";
import {
    PROPERTY_FACT_FIELDS,
    PROPERTY_FACT_FIELD_KEYS,
    factFieldLabel,
} from "../config/propertyFactFields";
import { ListingGroupService } from "./ListingGroupService";
import { Hostify } from "../client/Hostify";
import {
    buildHostifyListingUpdate,
    MappedFact,
    SkippedFact,
} from "../helpers/propertyFactsHostifyMapper";

/**
 * PropertyFactsService — the Verified Property Facts layer.
 *
 * Preset per-property fields at the TOP of the AI's knowledge hierarchy:
 * verified values override listing descriptions, KB entries and learned
 * facts. Fills itself through the correction queue (proposals created from
 * rep feedback and audit wrong_info misses) rather than upfront data entry.
 */
export class PropertyFactsService {
    private factRepo = appDatabase.getRepository(PropertyFactEntity);
    private proposalRepo = appDatabase.getRepository(PropertyFactProposalEntity);

    /** Resolve any (child) listing id to the canonical group id facts live on. */
    async canonicalId(listingId: number): Promise<number> {
        try {
            const canon = await new ListingGroupService().resolve(listingId);
            return canon || listingId;
        } catch {
            return listingId;
        }
    }

    /** All facts for a listing (canonical-resolved), keyed by fieldKey. */
    async getForListing(listingId: number): Promise<{
        listingId: number;
        facts: PropertyFactEntity[];
        catalog: typeof PROPERTY_FACT_FIELDS;
    }> {
        const canonical = await this.canonicalId(listingId);
        const facts = await this.factRepo.find({ where: { listingId: canonical } });
        return { listingId: canonical, facts, catalog: PROPERTY_FACT_FIELDS };
    }

    /**
     * Upsert a fact value. Manual staff edits are verified immediately (the
     * human just typed the truth); automated sources stay unverified.
     */
    async upsert(input: {
        listingId: number;
        fieldKey: string;
        value: string | null;
        source: string;
        verified?: boolean;
        userId?: number | null;
        /** When true, never overwrite an existing value (prefill semantics). */
        onlyIfEmpty?: boolean;
    }): Promise<PropertyFactEntity | null> {
        if (!PROPERTY_FACT_FIELD_KEYS.has(input.fieldKey)) {
            throw new Error(`Unknown property fact field: ${input.fieldKey}`);
        }
        const canonical = await this.canonicalId(input.listingId);
        let row = await this.factRepo.findOne({
            where: { listingId: canonical, fieldKey: input.fieldKey },
        });
        if (row && input.onlyIfEmpty && row.value && row.value.trim()) return row;
        if (!row) {
            row = this.factRepo.create({ listingId: canonical, fieldKey: input.fieldKey });
        }
        row.value = input.value != null ? String(input.value).slice(0, 4000) : null;
        row.source = input.source;
        row.updatedByUserId = input.userId ?? null;
        if (input.verified) {
            row.status = "verified";
            row.verifiedByUserId = input.userId ?? null;
            row.verifiedAt = new Date();
        } else {
            row.status = "unverified";
            row.verifiedByUserId = null;
            row.verifiedAt = null;
        }
        return this.factRepo.save(row);
    }

    /** Mark an existing fact verified without changing the value. */
    async verify(factId: number, userId?: number | null): Promise<PropertyFactEntity | null> {
        const row = await this.factRepo.findOne({ where: { id: factId } });
        if (!row) return null;
        row.status = "verified";
        row.verifiedByUserId = userId ?? null;
        row.verifiedAt = new Date();
        return this.factRepo.save(row);
    }

    // ------------------------------------------------------------------
    // Push to Hostify
    // ------------------------------------------------------------------

    /**
     * Push VERIFIED facts to Hostify's listing settings (POST /listings/update).
     * Only fact fields with a Hostify equivalent that parse cleanly are sent;
     * the rest are reported as skipped so staff can see exactly what happened.
     * With dryRun the mapped payload is returned without calling Hostify —
     * used by the UI to show a confirmation preview.
     */
    async pushToHostify(
        listingId: number,
        opts: { dryRun?: boolean } = {}
    ): Promise<{
        dryRun: boolean;
        listingId: number;
        mapped: MappedFact[];
        skipped: SkippedFact[];
        hostify?: any;
    }> {
        const canonical = await this.canonicalId(listingId);
        const rows = await this.factRepo.find({
            where: { listingId: canonical, status: "verified" },
        });
        const values: Record<string, string> = {};
        for (const r of rows) {
            if (r.value && r.value.trim()) values[r.fieldKey] = r.value.trim();
        }
        const { payload, mapped, skipped } = buildHostifyListingUpdate(values);

        if (opts.dryRun) {
            return { dryRun: true, listingId, mapped, skipped };
        }
        if (!mapped.length) {
            throw new Error("No verified facts map to Hostify listing fields");
        }
        const apiKey = process.env.HOSTIFY_API_KEY || "";
        if (!apiKey) {
            throw new Error("HOSTIFY_API_KEY is not configured");
        }
        // Push to the listing the user is viewing (not the canonical group id):
        // that's the actual Hostify listing whose settings should change.
        const hostify = await new Hostify().updateListing(apiKey, {
            listing_id: listingId,
            ...payload,
        });
        logger.info(
            `[PropertyFacts] Pushed ${mapped.length} field(s) to Hostify listing ${listingId}: ${mapped
                .map((m) => `${m.param}=${m.value}`)
                .join(", ")}`
        );
        return { dryRun: false, listingId, mapped, skipped, hostify };
    }

    // ------------------------------------------------------------------
    // Prompt block — consumed by InboxAIService.buildContext
    // ------------------------------------------------------------------

    /**
     * The context block for guest replies. Verified facts are the highest
     * authority in the prompt; unverified prefills are deliberately EXCLUDED —
     * they exist for staff review only, and feeding them to the model would
     * just re-launder the same unreliable sources the layer is replacing.
     */
    async buildPromptBlock(groupIds: number[]): Promise<string | null> {
        if (!groupIds.length) return null;
        const rows = await this.factRepo.find({
            where: { listingId: In(groupIds), status: "verified" },
        });
        const withValue = rows.filter((r) => r.value && r.value.trim());
        if (!withValue.length) return null;
        const lines: string[] = [
            "## VERIFIED PROPERTY FACTS (highest authority)",
            "Human-confirmed facts for THIS property. If ANYTHING else in this prompt (listing description, Knowledge Base, learned Q&A, message history) contradicts a line below, the line below wins. You may state these as certain.",
        ];
        for (const r of withValue) {
            lines.push(`- ${factFieldLabel(r.fieldKey)}: ${String(r.value).replace(/\s+/g, " ").trim()}`);
        }
        return lines.join("\n");
    }

    // ------------------------------------------------------------------
    // Correction queue
    // ------------------------------------------------------------------

    async listProposals(opts: { listingId?: number | null; status?: string } = {}) {
        const where: Record<string, unknown> = { status: opts.status || "pending" };
        if (opts.listingId) where.listingId = await this.canonicalId(Number(opts.listingId));
        return this.proposalRepo.find({ where, order: { createdAt: "DESC" }, take: 200 });
    }

    /**
     * Accept (optionally with an edited value) or reject a proposal.
     * Accepting writes the VERIFIED fact — this is the moment truth enters.
     */
    async reviewProposal(
        id: number,
        action: "accept" | "reject",
        opts: { userId?: number | null; value?: string | null } = {}
    ): Promise<PropertyFactProposalEntity | null> {
        const row = await this.proposalRepo.findOne({ where: { id } });
        if (!row) return null;
        row.status = action === "accept" ? "accepted" : "rejected";
        row.reviewedByUserId = opts.userId ?? null;
        row.reviewedAt = new Date();
        await this.proposalRepo.save(row);
        if (action === "accept") {
            await this.upsert({
                listingId: row.listingId,
                fieldKey: row.fieldKey,
                value: opts.value != null && String(opts.value).trim() ? String(opts.value) : row.proposedValue,
                source: "correction",
                verified: true,
                userId: opts.userId ?? null,
            });
        }
        return row;
    }

    /**
     * End-of-day sweep: analyze recent chat feedback (ANY rating or target
     * type, as long as the rep wrote something) for stable property facts and
     * file them as pending proposals on the Verified Facts page.
     *
     * The immediate path in recordFeedback only covers downvote+text; this
     * catches everything else ("we do accept events" left as a note on an
     * upvote, general feedback, sent-reply reviews) and retries rows the
     * immediate path missed (e.g. transient OpenAI failures). Each feedback
     * row is stamped factSweepAt after one analysis so it is never re-sent to
     * the extractor, and rows that already produced proposals are skipped.
     */
    async sweepFeedbackProposals(
        opts: { sinceDays?: number; limit?: number } = {}
    ): Promise<{ scanned: number; proposed: number }> {
        const since = new Date();
        since.setDate(since.getDate() - (opts.sinceDays ?? 3));
        const feedbackRepo = appDatabase.getRepository(AIMessageFeedbackEntity);
        const rows = await feedbackRepo
            .createQueryBuilder("f")
            .where("f.createdAt >= :since", { since })
            .andWhere("f.factSweepAt IS NULL")
            .andWhere("f.listingId IS NOT NULL")
            .andWhere("(COALESCE(f.correctedResponse, '') <> '' OR COALESCE(f.feedbackText, '') <> '')")
            .orderBy("f.createdAt", "ASC")
            .take(opts.limit ?? 50)
            .getMany();

        let proposed = 0;
        for (const f of rows) {
            const correction = (f.correctedResponse || f.feedbackText || "").trim();
            if (correction) {
                const already = await this.proposalRepo.findOne({
                    where: { sourceType: "feedback", sourceId: f.id },
                });
                if (!already) {
                    proposed += await this.proposeFromCorrection({
                        listingId: Number(f.listingId),
                        aiText: f.originalMessage,
                        correctionText: correction,
                        sourceType: "feedback",
                        sourceId: f.id,
                    });
                }
            }
            f.factSweepAt = new Date();
            await feedbackRepo.save(f);
        }
        if (rows.length) {
            logger.info(
                `[PropertyFacts] feedback sweep: ${rows.length} row(s) analyzed, ${proposed} proposal(s) filed`
            );
        }
        return { scanned: rows.length, proposed };
    }

    /**
     * Extract fact-change proposals from a correction (rep downvote text or a
     * team reply that contradicted the AI). Fire-and-forget from callers —
     * never throws, dedupes on (listing, field, pending).
     */
    async proposeFromCorrection(input: {
        listingId: number;
        aiText: string | null;
        correctionText: string;
        guestText?: string | null;
        sourceType: "feedback" | "audit_wrong_info";
        sourceId?: number | null;
    }): Promise<number> {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || !input.correctionText?.trim() || !input.listingId) return 0;
        try {
            const canonical = await this.canonicalId(input.listingId);
            const openai = new OpenAI({ apiKey });
            const fieldList = PROPERTY_FACT_FIELDS.map((f) => `${f.key} — ${f.label}`).join("\n");
            const resp = await openai.chat.completions.create({
                model: process.env.AI_MESSAGING_MODEL || "gpt-4.1",
                temperature: 0,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content: [
                            "You maintain a short-term-rental property fact sheet with FIXED preset fields.",
                            "A staff member corrected an AI reply. Extract the STABLE property fact(s) the correction establishes, mapped onto the preset fields below. Rules:",
                            "- Only extract facts stated by the STAFF CORRECTION (ground truth), never from the AI reply.",
                            "- Only STABLE facts a future guest could be told (fees, policies, amenities, capacities, schedules). NEVER one-off decisions, reservation-specific statuses, apologies, or guest personal data.",
                            "- The value must be self-contained and guest-shareable, including fee structure (per night vs flat) when relevant.",
                            "- If nothing maps to a preset field, return an empty array. Do not force a match.",
                            "- At most 3 facts.",
                            `PRESET FIELDS:\n${fieldList}`,
                            'Respond with STRICT JSON only: {"facts":[{"field":"<preset key>","value":"<concise value>"}]}',
                        ].join("\n"),
                    },
                    {
                        role: "user",
                        content:
                            (input.guestText ? `GUEST MESSAGE: ${input.guestText.slice(0, 400)}\n` : "") +
                            (input.aiText ? `AI REPLY (contained the error): ${input.aiText.slice(0, 500)}\n` : "") +
                            `STAFF CORRECTION (ground truth): ${input.correctionText.slice(0, 800)}`,
                    },
                ],
            });
            const parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
            const facts: { field?: string; value?: string }[] = Array.isArray(parsed?.facts) ? parsed.facts : [];
            let created = 0;
            for (const f of facts.slice(0, 3)) {
                const key = String(f?.field || "");
                const value = String(f?.value || "").trim();
                if (!PROPERTY_FACT_FIELD_KEYS.has(key) || !value) continue;
                const dupe = await this.proposalRepo.findOne({
                    where: { listingId: canonical, fieldKey: key, status: "pending" },
                });
                if (dupe) continue;
                const current = await this.factRepo.findOne({
                    where: { listingId: canonical, fieldKey: key },
                });
                await this.proposalRepo.save(
                    this.proposalRepo.create({
                        listingId: canonical,
                        fieldKey: key,
                        currentValue: current?.value ?? null,
                        proposedValue: value.slice(0, 4000),
                        sourceType: input.sourceType,
                        sourceId: input.sourceId ?? null,
                        evidence: [
                            input.guestText ? `Guest: ${input.guestText.slice(0, 300)}` : null,
                            input.aiText ? `AI said: ${input.aiText.slice(0, 300)}` : null,
                            `Correction: ${input.correctionText.slice(0, 500)}`,
                        ]
                            .filter(Boolean)
                            .join("\n"),
                        status: "pending",
                    })
                );
                created++;
            }
            if (created) {
                logger.info(
                    `[PropertyFacts] ${created} proposal(s) from ${input.sourceType} for listing ${canonical}`
                );
            }
            return created;
        } catch (err: any) {
            logger.warn(`[PropertyFacts] proposal extraction failed: ${err.message}`);
            return 0;
        }
    }
}
