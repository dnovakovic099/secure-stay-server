import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * AIMessageSuggestion
 * A persisted AI-generated reply suggestion for a v2 inbox conversation.
 *
 * The assistant is SUGGESTION-ONLY — it never auto-sends. Every suggestion is
 * stored (even when a human already replied) so we can compare AI vs human and
 * feed the nightly learning job. Status tracks what the human did with it.
 */
@Entity("ai_message_suggestions")
export class AIMessageSuggestionEntity {
    @PrimaryGeneratedColumn() id: number;

    @Index() @Column({ type: "bigint" }) threadId: number;

    /** externalId of the inbound guest message this responds to (nullable). */
    @Index() @Column({ type: "bigint", nullable: true }) messageId: number | null;

    @Column({ type: "bigint", nullable: true }) reservationId: number | null;
    @Column({ type: "bigint", nullable: true }) listingId: number | null;

    @Column({ type: "mediumtext", nullable: true }) suggestedReply: string | null;

    /** 0..100 model-reported confidence. */
    @Column({ type: "decimal", precision: 5, scale: 2, nullable: true }) confidence: number | null;

    @Column({ type: "tinyint", default: 0 }) escalationRequired: number;
    @Column({ length: 500, nullable: true }) escalationReason: string | null;

    @Column({ type: "text", nullable: true }) internalSummary: string | null;

    /** JSON-encoded string[] of source references the model used. */
    @Column({ type: "text", nullable: true }) sourcesUsed: string | null;
    /** JSON-encoded string[] of missing-info warnings. */
    @Column({ type: "text", nullable: true }) warnings: string | null;
    /** JSON-encoded string[] of suggested internal action items. */
    @Column({ type: "text", nullable: true }) suggestedActionItems: string | null;

    @Column({ length: 64, nullable: true }) modelName: string | null;
    @Column({ length: 32, nullable: true }) promptVersion: string | null;

    /** suggested | accepted | edited | ignored | rejected | regenerated */
    @Index() @Column({ length: 20, default: "suggested" }) status: string;

    @Column({ type: "int", nullable: true }) acceptedByUserId: number | null;
    @Column({ type: "bigint", nullable: true }) finalSentMessageId: number | null;

    /** Raw model response for debugging/audit. */
    @Column({ type: "mediumtext", nullable: true }) rawResponse: string | null;

    /**
     * Learning loop: what the team actually sent to the guest for this message,
     * captured by the nightly audit even when they didn't click "use reply".
     * replySimilarity is 0..100 (how close the human answer was to the AI's).
     */
    @Column({ type: "mediumtext", nullable: true }) actualReplyText: string | null;
    @Column({ type: "bigint", nullable: true }) actualReplyMessageId: number | null;
    @Column({ type: "datetime", nullable: true }) actualReplyAt: Date | null;
    @Column({ type: "decimal", precision: 5, scale: 2, nullable: true }) replySimilarity: number | null;
    /** Semantic (embedding cosine) similarity 0..100 between suggestion and actual reply. */
    @Column({ type: "decimal", precision: 5, scale: 2, nullable: true }) replySemanticSimilarity: number | null;
    /**
     * North-star answer-quality metric (0..100): how much of the SUBSTANCE in the
     * team's reply the AI reply also covered, sentence-by-sentence — length- and
     * verbosity-invariant, so it rises as self-learning adds facts the bot then uses.
     * NULL when the team reply had no substantive content (e.g. a pure acknowledgement).
     */
    @Column({ type: "decimal", precision: 5, scale: 2, nullable: true }) replyCoverageScore: number | null;
    /**
     * Whether the AI suggestion and the captured team reply are answering the SAME
     * guest message: "clean" (comparable), "guest_followup" (guest sent a newer
     * message before the team replied — not comparable), or "unknown".
     */
    @Column({ length: 20, nullable: true }) auditMatchQuality: string | null;
    /**
     * LLM judgement of whether the team's reply actually ANSWERS the guest's
     * message: "relevant" | "off_topic" (team said something unrelated — e.g.
     * "we'll call your phone" to a parking question — which no AI could predict)
     * | "unknown". Off-topic pairs are excluded from quality scores but kept and
     * surfaced on Analytics as "not valid for scoring" so we can learn from them.
     */
    @Column({ length: 20, nullable: true }) replyRelevance: string | null;
    /** One-line judge explanation for off_topic verdicts (for the Analytics list). */
    @Column({ length: 255, nullable: true }) replyRelevanceNote: string | null;
    /**
     * LLM judgement of the AI's own reply against the guest's message:
     * "addressed" (reasonably answered what was asked) | "missed" (guest asked
     * for something the AI failed to provide but the team did) | "unknown".
     * Drives audit ordering on Analytics: true misses first, fine replies last.
     */
    @Column({ length: 20, nullable: true }) aiReplyQuality: string | null;
    /** One-line judge explanation of WHAT the AI missed (only set for "missed"). */
    @Column({ length: 255, nullable: true }) aiReplyQualityNote: string | null;
    /**
     * Root cause for a "missed" verdict, so fixes can be routed:
     * "missing_info" (property fact absent → add to KB) | "wrong_info"
     * (AI stated something incorrect → correct the KB) | "deferral"
     * (AI escalated/deferred when it could have answered) | "other".
     */
    @Column({ length: 30, nullable: true }) aiReplyQualityCategory: string | null;
    /** Set when a human marks this miss as handled in the "Replies to fix" queue. */
    @Column({ type: "datetime", nullable: true }) missResolvedAt: Date | null;
    @Column({ type: "datetime", nullable: true }) auditedAt: Date | null;

    @Index() @Column({ type: "datetime" }) generatedAt: Date;

    @CreateDateColumn({ type: "timestamp" }) createdAt: Date;
    @UpdateDateColumn({ type: "timestamp" }) updatedAt: Date;
}
