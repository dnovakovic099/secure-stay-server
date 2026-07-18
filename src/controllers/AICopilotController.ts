import { NextFunction, Request, Response } from "express";
import { AIMessagingSettingsService } from "../services/AIMessagingSettingsService";
import { AICopilotService } from "../services/AICopilotService";
import { InboxAIService } from "../services/InboxAIService";
import { InboxItemDetectionService } from "../services/InboxItemDetectionService";
import { AILearnedFactsService, checkInstructionSupport } from "../services/AILearnedFactsService";
import { InboxAIAuditService } from "../services/InboxAIAuditService";
import { ListingKnowledgeSeeder } from "../services/ListingKnowledgeSeeder";
import { ListingGroupService } from "../services/ListingGroupService";
import { ExemplarService } from "../services/ExemplarService";
import { RetrievalService } from "../services/RetrievalService";
import { QuoInboxService } from "../services/QuoInboxService";
import { OpsRadarService } from "../services/OpsRadarService";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: any;
}

const toNum = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const userName = (user: any): string | null =>
    user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || null;
const userId = (user: any): number | null => toNum(user?.secureStayUserId ?? user?.id);

/**
 * Backs the GR "AI" page: Settings (tone/rules/topics/auto-respond), AI Copilot
 * (suggestion review), and AI Manager (response metrics).
 */
export class AICopilotController {
    /** Combined config: env enablement + editable global settings. */
    async getSettings(request: Request, response: Response, next: NextFunction) {
        try {
            const settingsService = new AIMessagingSettingsService();
            const settings = await settingsService.getGlobal();
            if (request.query.refreshQuoLines === "true") {
                try {
                    await new QuoInboxService().syncPhoneLines();
                } catch (err: any) {
                    logger.warn(`[AICopilot] Quo line refresh failed: ${err?.message}`);
                }
            }
            const quoLines = await settingsService.listQuoAutoRespondLines();
            return response.status(200).json({
                status: true,
                data: {
                    enabled: InboxAIService.isEnabled(),
                    autosend: await InboxAIService.autosendConfigAsync(),
                    quoAutosend: {
                        enabled: Boolean(settings.quoAutoRespondEnabled),
                        lines: quoLines,
                    },
                    settings,
                },
            });
        } catch (error) {
            return next(error);
        }
    }

    async updateSettings(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const b = request.body || {};
            const saved = await new AIMessagingSettingsService().update({
                tone: b.tone,
                communicationRules: b.communicationRules,
                communicationRuleEntries: Array.isArray(b.communicationRuleEntries)
                    ? b.communicationRuleEntries
                    : undefined,
                topicsToAvoid: b.topicsToAvoid,
                capabilityLimits: b.capabilityLimits,
                useListingDataForTopics: Array.isArray(b.useListingDataForTopics)
                    ? b.useListingDataForTopics.map(String)
                    : undefined,
                airbnbSupportRules: b.airbnbSupportRules,
                autoRespondEnabled: typeof b.autoRespondEnabled === "boolean" ? b.autoRespondEnabled : undefined,
                quoAutoRespondEnabled: typeof b.quoAutoRespondEnabled === "boolean" ? b.quoAutoRespondEnabled : undefined,
                quoLineAutoRespond: Array.isArray(b.quoLineAutoRespond) ? b.quoLineAutoRespond : undefined,
                autosendMinConfidence: toNum(b.autosendMinConfidence) ?? undefined,
                autosendChannels: b.autosendChannels,
                autosendTierEnabled: typeof b.autosendTierEnabled === "boolean" ? b.autosendTierEnabled : undefined,
                autosendInstantMinConfidence: toNum(b.autosendInstantMinConfidence) ?? undefined,
                autosendDelayedMinConfidence: toNum(b.autosendDelayedMinConfidence) ?? undefined,
                autosendDelayMinutes: toNum(b.autosendDelayMinutes) ?? undefined,
                inquirySalesRules: b.inquirySalesRules,
                inquiryAutoRespondEnabled:
                    typeof b.inquiryAutoRespondEnabled === "boolean" ? b.inquiryAutoRespondEnabled : undefined,
                selfServiceTroubleshootingEnabled:
                    typeof b.selfServiceTroubleshootingEnabled === "boolean" ? b.selfServiceTroubleshootingEnabled : undefined,
                opsAlertEmails: b.opsAlertEmails,
                paymentAlertEmails: b.paymentAlertEmails,
                itemDetectionEnabled: typeof b.itemDetectionEnabled === "boolean" ? b.itemDetectionEnabled : undefined,
                actionItemRules: b.actionItemRules,
                actionItemCategories: Array.isArray(b.actionItemCategories) ? b.actionItemCategories : undefined,
                guestIssueRules: b.guestIssueRules,
                guestIssueCategories: Array.isArray(b.guestIssueCategories) ? b.guestIssueCategories : undefined,
                detectionFeedback: b.detectionFeedback,
                userId: userId(request.user),
                userName: userName(request.user),
            });
            return response.status(200).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    async listSuggestions(request: Request, response: Response, next: NextFunction) {
        try {
            const data = await new AICopilotService().listSuggestions({
                status: (request.query.status as string) || undefined,
                escalationOnly: request.query.escalationOnly === "true",
                warningsOnly: request.query.warningsOnly === "true",
                limit: toNum(request.query.limit) || undefined,
                offset: toNum(request.query.offset) || undefined,
            });
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async metrics(request: Request, response: Response, next: NextFunction) {
        try {
            const data = await new AICopilotService().metrics({ sinceDays: toNum(request.query.sinceDays) || undefined });
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** Detected Action Item / Guest Issue proposals (review surface). */
    async detectedItems(request: Request, response: Response, next: NextFunction) {
        try {
            const data = await new InboxItemDetectionService().listProposals({
                type: (request.query.type as string) || undefined,
                status: (request.query.status as string) || undefined,
                limit: toNum(request.query.limit) || undefined,
            });
            return response.status(200).json({ status: true, data, enabledByEnv: InboxItemDetectionService.isEnabledByEnv() });
        } catch (error) {
            return next(error);
        }
    }

    /**
     * Learned facts (per-property + portfolio-wide) proposed by the nightly audit.
     * Staff review these here; only approved facts feed the bot.
     */
    async listLearnedFacts(request: Request, response: Response, next: NextFunction) {
        try {
            const data = await new AILearnedFactsService().list({
                status: (request.query.status as string) || undefined,
                scope: (request.query.scope as string) || undefined,
                listingId: toNum(request.query.listingId) ?? undefined,
                factType: (request.query.factType as string) || undefined,
            });
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async reviewLearnedFact(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = toNum(request.params.id);
            const action = String(request.body?.action || request.query.action || "").toLowerCase();
            if (!id || !["approve", "reject", "pending"].includes(action)) {
                return response.status(400).json({ status: false, message: "id and action (approve|reject|pending) required" });
            }
            const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "pending";
            const saved = await new AILearnedFactsService().setStatus(id, status as any, userId(request.user));
            return response.status(200).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    // -------------------------------------------------------------------------
    // Guest Simulator — "act as a guest, see the bot's reply, and teach it"
    // -------------------------------------------------------------------------

    /** Generate a bot reply for a simulated multi-turn conversation on a listing. */
    async sandboxReply(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            if (!InboxAIService.isEnabled()) {
                return response.status(503).json({ status: false, disabled: true, message: "AI messaging is disabled" });
            }
            const listingId = toNum(request.body?.listingId);
            if (!listingId) {
                return response.status(400).json({ status: false, message: "listingId is required" });
            }
            const rawTurns = Array.isArray(request.body?.messages) ? request.body.messages : [];
            const turns = rawTurns
                .map((t: any) => ({
                    role: t?.role === "host" ? "host" : "guest",
                    text: typeof t?.text === "string" ? t.text : "",
                }))
                .filter((t: any) => t.text.trim());
            if (!turns.some((t: any) => t.role === "guest")) {
                return response.status(400).json({ status: false, message: "At least one guest message is required" });
            }
            const phase = ["inquiry", "accepted", "in_house", "post_stay", "cancelled"].includes(request.body?.reservationStatus)
                ? (request.body.reservationStatus as string)
                : null;
            const textOrNull = (value: unknown, max = 255) =>
                typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
            const numberOrNull = (value: unknown) => {
                const n = Number(value);
                return Number.isFinite(n) ? n : null;
            };
            const dateOrNull = (value: unknown) =>
                typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
            const data = await new InboxAIService().sandboxReply(listingId, turns, {
                reservationStatus: phase,
                channel: textOrNull(request.body?.channel, 64),
                guestName: textOrNull(request.body?.guestName, 255),
                checkin: dateOrNull(request.body?.checkin),
                checkout: dateOrNull(request.body?.checkout),
                guests: numberOrNull(request.body?.guests),
                price: numberOrNull(request.body?.price),
                currency: textOrNull(request.body?.currency, 8),
            });
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** Teach the bot: save a Q&A as a learned fact for the listing (auto-approved). */
    async sandboxTeach(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const listingId = toNum(request.body?.listingId);
            const question = typeof request.body?.question === "string" ? request.body.question.trim() : "";
            const answer = typeof request.body?.answer === "string" ? request.body.answer.trim() : "";
            const scope = request.body?.scope === "portfolio" ? "portfolio" : "property";
            const factType =
                request.body?.factType === "style_rule" || request.body?.factType === "topic_to_avoid"
                    ? request.body.factType
                    : "qa";
            const visibility = request.body?.visibility === "internal" ? "internal" : "external";
            const acknowledgeUnsupported = request.body?.acknowledgeUnsupported === true;
            if (!answer) {
                return response.status(400).json({ status: false, message: "answer is required" });
            }
            if (scope === "property" && !listingId) {
                return response.status(400).json({ status: false, message: "listingId is required for property-scoped facts" });
            }
            // Capability guardrail: block instructions the AI can't actually
            // execute unless the reviewer has explicitly acknowledged the
            // limitation (client will re-submit with acknowledgeUnsupported).
            const checkTargets = [question, answer].filter(Boolean).join("\n");
            const capability = checkInstructionSupport(checkTargets);
            if (!capability.supported && !acknowledgeUnsupported) {
                return response.status(422).json({
                    status: false,
                    code: "UNSUPPORTED_INSTRUCTION",
                    message: capability.reason || "This instruction is outside the AI's current capabilities.",
                });
            }
            const topic = question || answer;
            const saved = await new AILearnedFactsService().upsert(
                {
                    scope,
                    listingId: scope === "portfolio" ? null : listingId,
                    topic,
                    question: question || null,
                    answer,
                    factType,
                    visibility,
                    source: "simulator",
                    createdByUserId: userId(request.user),
                },
                // Staff explicitly taught this — trusted, no frequency gate.
                { autoApprove: true, trustedSource: true }
            );
            return response.status(201).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    /** Record thumbs / correction feedback from the simulator (listing-scoped). */
    async sandboxFeedback(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const b = request.body || {};
            const saved = await new InboxAIService().recordFeedback({
                listingId: toNum(b.listingId),
                userId: userId(request.user),
                rating: typeof b.rating === "string" ? b.rating : null,
                categories: Array.isArray(b.categories) ? b.categories.map(String) : null,
                feedbackText: typeof b.feedbackText === "string" ? b.feedbackText : null,
                correctedResponse: typeof b.correctedResponse === "string" ? b.correctedResponse : null,
            });
            return response.status(201).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    /** Staff-edit a learned fact (answer / question / topic / scope). */
    async updateLearnedFact(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = toNum(request.params.id);
            if (!id) {
                return response.status(400).json({ status: false, message: "id required" });
            }
            const b = request.body || {};
            const saved = await new AILearnedFactsService().update(
                id,
                {
                    answer: b.answer,
                    question: b.question,
                    topic: b.topic,
                    scope: b.scope,
                    listingId: b.listingId === undefined ? undefined : toNum(b.listingId),
                    factType:
                        b.factType === "qa" || b.factType === "style_rule" || b.factType === "topic_to_avoid"
                            ? b.factType
                            : undefined,
                    visibility:
                        b.visibility === "internal" || b.visibility === "external" ? b.visibility : undefined,
                },
                userId(request.user)
            );
            return response.status(200).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    /** Bulk-approve pending learned facts (optionally scoped). */
    async approveAllLearnedFacts(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const result = await new AILearnedFactsService().approveAllPending(
                {
                    scope: (request.body?.scope as string) || (request.query.scope as string) || undefined,
                    listingId: toNum(request.body?.listingId ?? request.query.listingId) ?? undefined,
                },
                userId(request.user)
            );
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    /** Manually trigger the nightly audit (for testing / on-demand refresh). */
    async runAudit(_request: Request, response: Response, next: NextFunction) {
        try {
            // Fire-and-forget so the request returns fast; progress is in the logs.
            new InboxAIAuditService()
                .runNightlyAudit()
                .catch((e) => console.error("[InboxAIAudit] manual run failed", e));
            return response.status(202).json({
                status: true,
                message: "Nightly audit started",
                extractionEnabled: InboxAIAuditService.extractionEnabled(),
            });
        } catch (error) {
            return next(error);
        }
    }

    /** Seed every listing's Knowledge Base from structured listing data (idempotent). */
    async seedKnowledgeFromListings(_request: Request, response: Response, next: NextFunction) {
        try {
            new ListingKnowledgeSeeder()
                .seedAll()
                .then((r) => console.log("[KBSeeder] done", r))
                .catch((e) => console.error("[KBSeeder] failed", e));
            return response.status(202).json({ status: true, message: "Knowledge base seeding started" });
        } catch (error) {
            return next(error);
        }
    }

    /** Rebuild the channel-split listing→group map from Hostify. */
    async rebuildListingGroups(_request: Request, response: Response, next: NextFunction) {
        try {
            new ListingGroupService()
                .rebuildFromHostify()
                .then((r) => console.log("[ListingGroup] rebuild done", r))
                .catch((e) => console.error("[ListingGroup] rebuild failed", e));
            return response.status(202).json({ status: true, message: "Listing group rebuild started" });
        } catch (error) {
            return next(error);
        }
    }

    /** Backfill the semantic retrieval store: Q&A exemplars + learned facts. */
    async backfillExemplars(request: Request, response: Response, next: NextFunction) {
        try {
            const sinceDays = request.body?.sinceDays ? Number(request.body.sinceDays) : undefined;
            (async () => {
                const ex = await new ExemplarService().backfillFromHistory({ sinceDays });
                const facts = await new RetrievalService().embedFacts();
                const kb = await new RetrievalService().embedKnowledge();
                console.log("[RAG] backfill done", { ...ex, factVectors: facts, kbVectors: kb });
            })().catch((e) => console.error("[RAG] backfill failed", e));
            return response.status(202).json({ status: true, message: "RAG backfill started" });
        } catch (error) {
            return next(error);
        }
    }

    /** One-shot: learn from the entire message history, strictly per-listing. */
    async backfillHistory(_request: Request, response: Response, next: NextFunction) {
        try {
            new InboxAIAuditService()
                .backfillAllHistory()
                .catch((e) => console.error("[InboxAIAudit] history backfill failed", e));
            return response.status(202).json({ status: true, message: "History backfill started" });
        } catch (error) {
            return next(error);
        }
    }

    // ------------------------------------------------------------------
    // Ops Radar — manage-by-exception alert feed
    // ------------------------------------------------------------------

    /** Open alerts (optionally filtered by type/status) + summary counts. */
    async opsAlerts(request: Request, response: Response, next: NextFunction) {
        try {
            const svc = new OpsRadarService();
            const [alerts, summary] = await Promise.all([
                svc.listAlerts({
                    type: request.query.type ? String(request.query.type) : undefined,
                    status: request.query.status ? String(request.query.status) : undefined,
                    limit: request.query.limit ? Number(request.query.limit) : undefined,
                }),
                svc.summary(),
            ]);
            return response.status(200).json({ status: true, data: { alerts, summary } });
        } catch (error) {
            return next(error);
        }
    }

    async opsDismissAlert(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const alert = await new OpsRadarService().dismiss(Number(request.params.id), userId(request.user));
            return response.status(200).json({ status: true, data: alert });
        } catch (error) {
            return next(error);
        }
    }

    async opsResolveAlert(request: Request, response: Response, next: NextFunction) {
        try {
            const alert = await new OpsRadarService().resolve(Number(request.params.id));
            return response.status(200).json({ status: true, data: alert });
        } catch (error) {
            return next(error);
        }
    }

    /** Manual "Scan now" — runs all sweeps and returns their tallies. */
    async opsScan(_request: Request, response: Response, next: NextFunction) {
        try {
            const result = await new OpsRadarService().runAll();
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    // ------------------------------------------------------------------
    // Conflict detector — contradictions between listing data / facts / KB
    // ------------------------------------------------------------------

    /** Open conflicts + counts. */
    async conflicts(request: Request, response: Response, next: NextFunction) {
        try {
            const { AIConflictDetectorService } = require("../services/AIConflictDetectorService");
            const svc = new AIConflictDetectorService();
            const [conflicts, summary] = await Promise.all([
                svc.list({
                    status: request.query.status ? String(request.query.status) : undefined,
                    listingId: request.query.listingId ? Number(request.query.listingId) : undefined,
                    limit: request.query.limit ? Number(request.query.limit) : undefined,
                }),
                svc.summary(),
            ]);
            return response.status(200).json({ status: true, data: { conflicts, summary } });
        } catch (error) {
            return next(error);
        }
    }

    async conflictResolve(request: Request, response: Response, next: NextFunction) {
        try {
            const { AIConflictDetectorService } = require("../services/AIConflictDetectorService");
            const row = await new AIConflictDetectorService().resolve(Number(request.params.id));
            return response.status(200).json({ status: true, data: row });
        } catch (error) {
            return next(error);
        }
    }

    async conflictDismiss(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { AIConflictDetectorService } = require("../services/AIConflictDetectorService");
            const row = await new AIConflictDetectorService().dismiss(Number(request.params.id), userId(request.user));
            return response.status(200).json({ status: true, data: row });
        } catch (error) {
            return next(error);
        }
    }

    /** Manual scan; ?force=true re-scans even unchanged listings. */
    async conflictScan(request: Request, response: Response, next: NextFunction) {
        try {
            const { AIConflictDetectorService } = require("../services/AIConflictDetectorService");
            const result = await new AIConflictDetectorService().sweep({
                force: String(request.query.force || request.body?.force || "") === "true",
            });
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }
}
