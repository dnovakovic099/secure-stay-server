import { NextFunction, Request, Response } from "express";
import { AIMessagingSettingsService } from "../services/AIMessagingSettingsService";
import { AICopilotService } from "../services/AICopilotService";
import { InboxAIService } from "../services/InboxAIService";
import { InboxItemDetectionService } from "../services/InboxItemDetectionService";
import { AILearnedFactsService } from "../services/AILearnedFactsService";
import { InboxAIAuditService } from "../services/InboxAIAuditService";
import { ListingKnowledgeSeeder } from "../services/ListingKnowledgeSeeder";
import { ListingGroupService } from "../services/ListingGroupService";
import { ExemplarService } from "../services/ExemplarService";
import { RetrievalService } from "../services/RetrievalService";

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
    async getSettings(_request: Request, response: Response, next: NextFunction) {
        try {
            const settings = await new AIMessagingSettingsService().getGlobal();
            return response.status(200).json({
                status: true,
                data: {
                    enabled: InboxAIService.isEnabled(),
                    autosend: await InboxAIService.autosendConfigAsync(),
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
                topicsToAvoid: b.topicsToAvoid,
                autoRespondEnabled: typeof b.autoRespondEnabled === "boolean" ? b.autoRespondEnabled : undefined,
                autosendMinConfidence: toNum(b.autosendMinConfidence) ?? undefined,
                autosendChannels: b.autosendChannels,
                itemDetectionEnabled: typeof b.itemDetectionEnabled === "boolean" ? b.itemDetectionEnabled : undefined,
                actionItemRules: b.actionItemRules,
                guestIssueRules: b.guestIssueRules,
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
                console.log("[RAG] backfill done", { ...ex, factVectors: facts });
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
}
