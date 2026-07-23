import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AICommunicationRuleProposalEntity } from "../entity/AICommunicationRuleProposal";
import { AIMessageFeedbackEntity } from "../entity/AIMessageFeedback";
import { AILearnedFactEntity } from "../entity/AILearnedFact";
import {
    AIMessagingSettingsService,
    CommunicationRuleEntry,
    normalizeEarlyLateHandling,
    parseCommunicationRuleEntries,
    buildTeamCommunicationRulesText,
} from "./AIMessagingSettingsService";
import { AI_REPLY_RULE_DEFAULTS } from "./InboxAIService";

export type RuleSource = "settings" | "code" | "learned" | "feedback" | "mode";

export interface EffectiveRuleSection {
    id: string;
    title: string;
    source: RuleSource;
    /** How this block is used at reply time. */
    howUsed: string;
    /** Whether operators can edit this in Settings (vs redeploy / Learned). */
    editableInSettings: boolean;
    /** True when the body is empty / using a code default. */
    usingDefault?: boolean;
    body: string;
    /** Optional structured rows for per-topic rules. */
    entries?: CommunicationRuleEntry[];
    meta?: Record<string, string | number | boolean | null>;
}

export interface ProposeRuleInput {
    topic: string;
    rule: string;
    appliesTo?: string | null;
    rationale?: string | null;
    sourceFeedbackIds?: number[];
    sourceSummary?: string | null;
    proposedByUserId?: number | null;
    proposedByName?: string | null;
}

const randomId = () => Math.random().toString(36).slice(2, 10);

function textOrDefault(value: string | null | undefined, fallback: string): { body: string; usingDefault: boolean } {
    const t = (value || "").trim();
    if (t) return { body: t, usingDefault: false };
    return { body: (fallback || "").trim(), usingDefault: true };
}

const LENGTH_AND_STYLE_SUMMARY = [
    "KEEP IT SHORT: 1-3 sentences for most messages; 4-5 max when the guest asked several things.",
    "Sound personal, not corporate. No filler hospitality phrases.",
    "Don't restate the guest's question; don't stack multiple closers.",
    "Use the guest's first name naturally; match their energy.",
    'BANNED: never write "you\'re all set" / "you are all set" / "all set for".',
].join("\n");

const PRINCIPLES_SUMMARY = [
    "Never invent facts (codes, prices, policies, amenities, addresses).",
    "Never claim an action is already done unless TEAM / ops context confirms it.",
    "Never approve complimentary nights, refunds, rebooking, or deposits without clear evidence.",
    "Never invent local events, property-experience claims, or amenity locations.",
    "Escalate discretionary / legal / safety / refund / cancellation topics.",
    "Prefer TEAM messages in this thread, then live listing/reservation data, then property KB, then portfolio.",
    "Full principle list is compiled into every guest-reply prompt (requires a deploy to change).",
].join("\n");

/**
 * Builds the read-only "rules the AI actually follows" reference for Settings,
 * plus the approval queue for communication-rule proposals from feedback.
 */
export class AICommunicationRulesService {
    private proposalRepo = appDatabase.getRepository(AICommunicationRuleProposalEntity);
    private feedbackRepo = appDatabase.getRepository(AIMessageFeedbackEntity);
    private factRepo = appDatabase.getRepository(AILearnedFactEntity);
    private settingsService = new AIMessagingSettingsService();

    private static tableEnsured = false;
    private async ensureProposalTable(): Promise<void> {
        if (AICommunicationRulesService.tableEnsured) return;
        try {
            await appDatabase.query(`
                CREATE TABLE IF NOT EXISTS \`ai_communication_rule_proposals\` (
                    \`id\` INT AUTO_INCREMENT PRIMARY KEY,
                    \`topic\` VARCHAR(160) NOT NULL,
                    \`rule\` MEDIUMTEXT NOT NULL,
                    \`appliesTo\` VARCHAR(255) NULL,
                    \`status\` VARCHAR(20) NOT NULL DEFAULT 'pending',
                    \`rationale\` TEXT NULL,
                    \`sourceFeedbackIds\` TEXT NULL,
                    \`sourceSummary\` MEDIUMTEXT NULL,
                    \`proposedByUserId\` INT NULL,
                    \`proposedByName\` VARCHAR(255) NULL,
                    \`reviewedByUserId\` INT NULL,
                    \`reviewedByName\` VARCHAR(255) NULL,
                    \`reviewedAt\` DATETIME NULL,
                    \`reviewNote\` TEXT NULL,
                    \`createdEntryId\` VARCHAR(64) NULL,
                    \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX \`idx_acrp_status\` (\`status\`),
                    INDEX \`idx_acrp_created\` (\`createdAt\`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
            AICommunicationRulesService.tableEnsured = true;
        } catch (err: any) {
            logger.warn(`[AICommunicationRules] ensureProposalTable: ${err?.message}`);
            AICommunicationRulesService.tableEnsured = true;
        }
    }

    async getEffectiveReference(): Promise<{
        generatedAt: string;
        sections: EffectiveRuleSection[];
        pendingProposalCount: number;
        approvedStyleRuleCount: number;
        approvedAvoidTopicCount: number;
    }> {
        await this.ensureProposalTable();
        const settings = await this.settingsService.getGlobal();
        const tone = (settings.tone || "warm").trim() || "warm";
        const teamRules = buildTeamCommunicationRulesText(settings);
        const entries = parseCommunicationRuleEntries(settings.communicationRuleEntries);

        const [styleCount, avoidCount, pendingProposalCount] = await Promise.all([
            this.factRepo.count({ where: { status: "approved", factType: "style_rule" } as any }),
            this.factRepo.count({ where: { status: "approved", factType: "topic_to_avoid" } as any }),
            this.proposalRepo.count({ where: { status: "pending" } }),
        ]);

        const baseStyle = textOrDefault(settings.baseReplyStyleRules, AI_REPLY_RULE_DEFAULTS.baseReplyStyleRules);
        const airbnbBase = textOrDefault(
            settings.airbnbSupportBaseRules,
            AI_REPLY_RULE_DEFAULTS.airbnbSupportBaseRules
        );
        const inquiryBase = textOrDefault(
            settings.inquirySalesBaseRules,
            AI_REPLY_RULE_DEFAULTS.inquirySalesBaseRules
        );
        const selfService = textOrDefault(
            settings.selfServiceTroubleshootingRules,
            AI_REPLY_RULE_DEFAULTS.selfServiceTroubleshootingRules
        );
        const quoSms = textOrDefault(settings.quoSmsRules, AI_REPLY_RULE_DEFAULTS.quoSmsRules);
        const quoPm = textOrDefault(settings.quoPmClientRules, AI_REPLY_RULE_DEFAULTS.quoPmClientRules);
        const quoUnlinked = textOrDefault(
            settings.quoUnlinkedThreadRules,
            AI_REPLY_RULE_DEFAULTS.quoUnlinkedThreadRules
        );

        const early = normalizeEarlyLateHandling(settings.earlyCheckinHandling);
        const late = normalizeEarlyLateHandling(settings.lateCheckoutHandling);

        const sections: EffectiveRuleSection[] = [
            {
                id: "tone",
                title: "Communication tone",
                source: "settings",
                howUsed: "Injected as COMMUNICATION STYLE on every guest-reply draft.",
                editableInSettings: true,
                body: `Adopt a ${tone} tone.`,
                meta: { tone },
            },
            {
                id: "team_communication_rules",
                title: "Team communication rules",
                source: "settings",
                howUsed:
                    "Injected as TEAM COMMUNICATION RULES. Per-topic entries are always included (topic labels help the model apply the right ones).",
                editableInSettings: true,
                body: teamRules || "(none configured — only code style + principles apply)",
                entries,
            },
            {
                id: "capability_limits",
                title: "Capability limits",
                source: "settings",
                howUsed: "Injected into the reply prompt when set; also gates teach/learn instructions the AI cannot execute.",
                editableInSettings: true,
                body: (settings.capabilityLimits || "").trim() || "(none configured)",
            },
            {
                id: "topics_to_avoid",
                title: "Topics to avoid / always escalate",
                source: "settings",
                howUsed: "Injected as TOPICS TO AVOID — model must escalate instead of answering.",
                editableInSettings: true,
                body: (settings.topicsToAvoid || "").trim() || "(none configured)",
            },
            {
                id: "length_style",
                title: "Length & style (code)",
                source: "code",
                howUsed: "Always injected. Changing this requires a server deploy.",
                editableInSettings: false,
                body: LENGTH_AND_STYLE_SUMMARY,
            },
            {
                id: "principles",
                title: "Safety principles (code)",
                source: "code",
                howUsed: "Always injected. Strongest guardrails against inventing facts / false approvals.",
                editableInSettings: false,
                body: PRINCIPLES_SUMMARY,
            },
            {
                id: "base_reply_style",
                title: "Base reply style rules",
                source: baseStyle.usingDefault ? "code" : "settings",
                howUsed: "Admin reply-rule block for all guest drafts when non-empty (or empty default).",
                editableInSettings: true,
                usingDefault: baseStyle.usingDefault,
                body: baseStyle.body || "(empty — no extra base style block)",
            },
            {
                id: "early_late",
                title: "Early check-in / late check-out handling",
                source: "settings",
                howUsed: "Rendered into the prompt for guest (non-Airbnb-support / non-PM) threads.",
                editableInSettings: true,
                body: `Early check-in: ${early}\nLate check-out: ${late}`,
                meta: { earlyCheckinHandling: early, lateCheckoutHandling: late },
            },
            {
                id: "inquiry_sales",
                title: "Inquiry sales mode rules",
                source: inquiryBase.usingDefault ? "code" : "settings",
                howUsed: "Applied only when the reservation is still a pre-booking inquiry.",
                editableInSettings: true,
                usingDefault: inquiryBase.usingDefault,
                body: [
                    inquiryBase.body,
                    (settings.inquirySalesRules || "").trim()
                        ? `\n\nTEAM INQUIRY SALES RULES:\n${(settings.inquirySalesRules || "").trim()}`
                        : "",
                ]
                    .join("")
                    .trim(),
                meta: {
                    inquiryAutoRespondEnabled: settings.inquiryAutoRespondEnabled === 1,
                },
            },
            {
                id: "airbnb_support",
                title: "Airbnb Support rules",
                source: airbnbBase.usingDefault ? "code" : "settings",
                howUsed: "Applied only when the thread is with Airbnb Support (not a guest).",
                editableInSettings: true,
                usingDefault: airbnbBase.usingDefault,
                body: [
                    airbnbBase.body,
                    (settings.airbnbSupportRules || "").trim()
                        ? `\n\nTEAM AIRBNB SUPPORT RULES:\n${(settings.airbnbSupportRules || "").trim()}`
                        : "",
                ]
                    .join("")
                    .trim(),
            },
            {
                id: "self_service",
                title: "Self-service troubleshooting",
                source: selfService.usingDefault ? "code" : "settings",
                howUsed: "Applied when Self-service troubleshooting is ON for guest threads.",
                editableInSettings: true,
                usingDefault: selfService.usingDefault,
                body: selfService.body,
                meta: {
                    enabled: settings.selfServiceTroubleshootingEnabled === 1,
                },
            },
            {
                id: "quo_sms",
                title: "Quo SMS / PM / unlinked rules",
                source: "mode",
                howUsed: "Channel-specific blocks for Quo SMS, PM-client threads, and unlinked SMS.",
                editableInSettings: true,
                body: [
                    `SMS:\n${quoSms.body}`,
                    `\n\nPM client:\n${quoPm.body}`,
                    `\n\nUnlinked thread:\n${quoUnlinked.body}`,
                ].join(""),
            },
            {
                id: "learned_style",
                title: "Approved learned style rules",
                source: "learned",
                howUsed: "Approved Learned → style_rule facts are injected into bot context (separate from Settings entries).",
                editableInSettings: false,
                body:
                    styleCount > 0
                        ? `${styleCount} approved style rule(s) currently feed the bot via the Learned tab.`
                        : "No approved style rules yet.",
                meta: { count: styleCount },
            },
            {
                id: "learned_avoid",
                title: "Approved learned topics to avoid",
                source: "learned",
                howUsed: "Approved Learned → topic_to_avoid facts are injected into bot context.",
                editableInSettings: false,
                body:
                    avoidCount > 0
                        ? `${avoidCount} approved topic-to-avoid fact(s) currently feed the bot.`
                        : "No approved topic-to-avoid facts yet.",
                meta: { count: avoidCount },
            },
            {
                id: "recent_feedback",
                title: "Recent manager feedback (ephemeral)",
                source: "feedback",
                howUsed:
                    "Last ~90 days of feedback with notes/corrections (up to ~10 lines) are injected as TEAM FEEDBACK. Not permanent rules — promote important ones via Rule proposals.",
                editableInSettings: false,
                body: "Recent thumbs-down notes and preferred wording steer the next drafts until they age out. Use Pending rule updates to make a lasting communication rule.",
            },
            {
                id: "automation",
                title: "Automation gates (not reply wording)",
                source: "settings",
                howUsed: "Controls whether a draft may auto-send — does not change the wording rules above.",
                editableInSettings: true,
                body: [
                    `Hostify auto-respond: ${settings.autoRespondEnabled === 1 ? "ON" : "OFF"}`,
                    `Quo auto-respond: ${settings.quoAutoRespondEnabled === 1 ? "ON" : "OFF"}`,
                    `Min confidence: ${settings.autosendMinConfidence}`,
                    `Tiered autosend: ${settings.autosendTierEnabled === 1 ? "ON" : "OFF"}`,
                    `Inquiry auto-respond: ${settings.inquiryAutoRespondEnabled === 1 ? "ON" : "OFF"}`,
                    `Proposed actions: ${settings.proposedActionsEnabled !== 0 ? "ON" : "OFF"}`,
                    `Rescue Copilot: ${settings.rescueCopilotEnabled !== 0 ? "ON" : "OFF"}`,
                    `Item detection: ${settings.itemDetectionEnabled === 1 ? "ON" : "OFF"}`,
                ].join("\n"),
            },
        ];

        return {
            generatedAt: new Date().toISOString(),
            sections,
            pendingProposalCount,
            approvedStyleRuleCount: styleCount,
            approvedAvoidTopicCount: avoidCount,
        };
    }

    async listProposals(status?: string): Promise<AICommunicationRuleProposalEntity[]> {
        await this.ensureProposalTable();
        const where: any = {};
        if (status && ["pending", "approved", "rejected"].includes(status)) {
            where.status = status;
        }
        return this.proposalRepo.find({
            where: Object.keys(where).length ? where : undefined,
            order: { createdAt: "DESC" },
            take: 200,
        });
    }

    async createProposal(input: ProposeRuleInput): Promise<AICommunicationRuleProposalEntity> {
        await this.ensureProposalTable();
        const topic = String(input.topic || "").trim().slice(0, 160);
        const rule = String(input.rule || "").trim();
        if (!topic || !rule) {
            throw Object.assign(new Error("topic and rule are required"), { status: 400 });
        }
        const ids = Array.isArray(input.sourceFeedbackIds)
            ? input.sourceFeedbackIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
            : [];
        const row = this.proposalRepo.create({
            topic,
            rule,
            appliesTo: input.appliesTo != null && String(input.appliesTo).trim() ? String(input.appliesTo).trim() : null,
            status: "pending",
            rationale: input.rationale != null ? String(input.rationale).trim() || null : null,
            sourceFeedbackIds: ids.length ? JSON.stringify(ids) : null,
            sourceSummary: input.sourceSummary != null ? String(input.sourceSummary).trim() || null : null,
            proposedByUserId: input.proposedByUserId ?? null,
            proposedByName: input.proposedByName ?? null,
        });
        return this.proposalRepo.save(row);
    }

    /**
     * Draft a pending proposal from a manager-feedback row.
     * Does not change live Settings until approved.
     */
    async proposeFromFeedback(
        feedbackId: number,
        opts: {
            topic?: string | null;
            rule?: string | null;
            appliesTo?: string | null;
            rationale?: string | null;
            proposedByUserId?: number | null;
            proposedByName?: string | null;
        } = {}
    ): Promise<AICommunicationRuleProposalEntity> {
        const fb = await this.feedbackRepo.findOne({ where: { id: feedbackId } });
        if (!fb) {
            throw Object.assign(new Error("Feedback not found"), { status: 404 });
        }

        let categories: string[] = [];
        try {
            const parsed = fb.categories ? JSON.parse(fb.categories) : [];
            if (Array.isArray(parsed)) categories = parsed.map(String);
        } catch {
            categories = [];
        }

        const topic =
            (opts.topic || "").trim() ||
            categories.find((c) => c && c !== "Other" && c !== "Good response") ||
            "Communication";

        const preferred = (opts.rule || "").trim() || this.draftRuleFromFeedback(fb, categories);
        if (!preferred) {
            throw Object.assign(
                new Error("Could not draft a rule — add feedback text or a corrected reply first"),
                { status: 400 }
            );
        }

        const summaryParts = [
            fb.rating ? `Rating: ${fb.rating}` : null,
            categories.length ? `Categories: ${categories.join(", ")}` : null,
            fb.feedbackText ? `Feedback: ${fb.feedbackText}` : null,
            fb.originalMessage ? `Original:\n${fb.originalMessage}` : null,
            fb.correctedResponse ? `Preferred wording:\n${fb.correctedResponse}` : null,
        ].filter(Boolean);

        return this.createProposal({
            topic: String(topic).slice(0, 160),
            rule: preferred,
            appliesTo: opts.appliesTo,
            rationale:
                (opts.rationale || "").trim() ||
                `Proposed from manager feedback #${feedbackId}` +
                    (categories.length ? ` (${categories.join(", ")})` : ""),
            sourceFeedbackIds: [feedbackId],
            sourceSummary: summaryParts.join("\n\n"),
            proposedByUserId: opts.proposedByUserId,
            proposedByName: opts.proposedByName,
        });
    }

    private draftRuleFromFeedback(fb: AIMessageFeedbackEntity, categories: string[]): string {
        const note = (fb.feedbackText || "").trim();
        const preferred = (fb.correctedResponse || "").trim();
        if (note && preferred) {
            return `${note}\n\nPrefer wording like: ${preferred}`;
        }
        if (note) return note;
        if (preferred) {
            const catHint = categories.length ? `For ${categories.join(" / ").toLowerCase()} cases: ` : "";
            return `${catHint}Prefer replies in this style: ${preferred}`;
        }
        return "";
    }

    async reviewProposal(
        id: number,
        action: "approve" | "reject",
        opts: {
            reviewedByUserId?: number | null;
            reviewedByName?: string | null;
            reviewNote?: string | null;
            topic?: string | null;
            rule?: string | null;
            appliesTo?: string | null;
        } = {}
    ): Promise<AICommunicationRuleProposalEntity> {
        await this.ensureProposalTable();
        const row = await this.proposalRepo.findOne({ where: { id } });
        if (!row) {
            throw Object.assign(new Error("Proposal not found"), { status: 404 });
        }
        if (row.status !== "pending") {
            throw Object.assign(new Error(`Proposal is already ${row.status}`), { status: 400 });
        }

        if (opts.topic != null && String(opts.topic).trim()) row.topic = String(opts.topic).trim().slice(0, 160);
        if (opts.rule != null && String(opts.rule).trim()) row.rule = String(opts.rule).trim();
        if (opts.appliesTo !== undefined) {
            row.appliesTo =
                opts.appliesTo != null && String(opts.appliesTo).trim() ? String(opts.appliesTo).trim() : null;
        }

        row.reviewedByUserId = opts.reviewedByUserId ?? null;
        row.reviewedByName = opts.reviewedByName ?? null;
        row.reviewedAt = new Date();
        row.reviewNote = opts.reviewNote != null ? String(opts.reviewNote).trim() || null : null;

        if (action === "reject") {
            row.status = "rejected";
            return this.proposalRepo.save(row);
        }

        const entryId = randomId();
        const entry: CommunicationRuleEntry = {
            id: entryId,
            topic: row.topic,
            rule: row.rule,
            appliesTo: row.appliesTo,
        };
        const settings = await this.settingsService.getGlobal();
        const existing = parseCommunicationRuleEntries(settings.communicationRuleEntries);
        await this.settingsService.update({
            communicationRuleEntries: [...existing, entry],
            userId: opts.reviewedByUserId ?? null,
            userName: opts.reviewedByName ?? null,
        });

        row.status = "approved";
        row.createdEntryId = entryId;
        return this.proposalRepo.save(row);
    }
}
