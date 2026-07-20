import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIMessagingSettingsEntity } from "../entity/AIMessagingSettings";
import { QuoPhoneLineEntity } from "../entity/QuoPhoneLine";

export interface CommunicationRuleEntry {
    id: string;
    topic: string;
    rule: string;
    appliesTo?: string | null;
}

export interface ActionItemCategoryEntry {
    id: string;
    name: string;
    description?: string | null;
    examples?: string | null;
    autoCreate?: boolean;
}

export interface AIMessagingSettingsPatch {
    tone?: string | null;
    communicationRules?: string | null;
    communicationRuleEntries?: CommunicationRuleEntry[] | null;
    topicsToAvoid?: string | null;
    capabilityLimits?: string | null;
    useListingDataForTopics?: string[] | null;
    airbnbSupportRules?: string | null;
    baseReplyStyleRules?: string | null;
    airbnbSupportBaseRules?: string | null;
    inquirySalesBaseRules?: string | null;
    selfServiceTroubleshootingRules?: string | null;
    quoSmsRules?: string | null;
    quoPmClientRules?: string | null;
    quoUnlinkedThreadRules?: string | null;
    autoRespondEnabled?: boolean;
    quoAutoRespondEnabled?: boolean;
    quoLineAutoRespond?: { phoneNumberId: string; enabled: boolean }[];
    autosendMinConfidence?: number;
    autosendChannels?: string | null;
    autosendTierEnabled?: boolean;
    autosendInstantMinConfidence?: number;
    autosendDelayedMinConfidence?: number;
    autosendDelayMinutes?: number;
    inquirySalesRules?: string | null;
    inquiryAutoRespondEnabled?: boolean;
    selfServiceTroubleshootingEnabled?: boolean;
    paymentAlertEmails?: string | null;
    opsAlertEmails?: string | null;
    itemDetectionEnabled?: boolean;
    actionItemRules?: string | null;
    actionItemCategories?: ActionItemCategoryEntry[] | null;
    guestIssueRules?: string | null;
    guestIssueCategories?: ActionItemCategoryEntry[] | null;
    /** Unified list that replaces the actionItem/guestIssue split. */
    ticketCategories?: ActionItemCategoryEntry[] | null;
    detectionFeedback?: string | null;
    proposedActionsEnabled?: boolean;
    proposedActionInstructions?: string | null;
    proposedActionApproveInstructions?: string | null;
    proposedActionApproveSendInstructions?: string | null;
    /** Admin-only ticket-creation instruction overrides. */
    detectorSystemPersona?: string | null;
    detectionExclusionRules?: string | null;
    detectionConfidenceFloor?: number | null;
    quoDetectorSystemPrompt?: string | null;
    betaDetectorSystemPrompt?: string | null;
    /** True when any of the instruction override fields are present in the patch. */
    instructionsEdited?: boolean;
    userId?: number | null;
    userName?: string | null;
}

const stringifyList = <T>(value: T[] | null | undefined): string | null => {
    if (!value || !Array.isArray(value)) return null;
    if (!value.length) return null;
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
};

/**
 * Global (single-row) settings for the inbox AI assistant. Cached briefly to
 * avoid a DB hit on every suggestion/webhook while still reflecting UI changes
 * within a few seconds.
 */
export class AIMessagingSettingsService {
    private repo = appDatabase.getRepository(AIMessagingSettingsEntity);
    private quoLineRepo = appDatabase.getRepository(QuoPhoneLineEntity);

    private static cache: AIMessagingSettingsEntity | null = null;
    private static cacheAt = 0;
    private static TTL_MS = 15000;

    /** The single global settings row, created with defaults if missing. */
    async getGlobal(): Promise<AIMessagingSettingsEntity> {
        let row = await this.repo.findOne({ where: { listingId: null as any } });
        if (!row) {
            row = this.repo.create({
                listingId: null,
                tone: "warm",
                communicationRules: null,
                topicsToAvoid: null,
                autoRespondEnabled: 0,
                quoAutoRespondEnabled: 0,
                autosendMinConfidence: 85,
                autosendChannels: null,
            });
            row = await this.repo.save(row);
        }
        return row;
    }

    /** Cached read for hot paths (prompt build, webhook auto-send gate). */
    async getGlobalCached(): Promise<AIMessagingSettingsEntity> {
        const now = Date.now();
        if (AIMessagingSettingsService.cache && now - AIMessagingSettingsService.cacheAt < AIMessagingSettingsService.TTL_MS) {
            return AIMessagingSettingsService.cache;
        }
        const row = await this.getGlobal();
        AIMessagingSettingsService.cache = row;
        AIMessagingSettingsService.cacheAt = now;
        return row;
    }

    async update(patch: AIMessagingSettingsPatch): Promise<AIMessagingSettingsEntity> {
        const row = await this.getGlobal();
        if (patch.tone !== undefined) row.tone = patch.tone ? String(patch.tone).slice(0, 64) : null;
        if (patch.communicationRules !== undefined) row.communicationRules = patch.communicationRules ?? null;
        if (patch.communicationRuleEntries !== undefined) {
            row.communicationRuleEntries = stringifyList(patch.communicationRuleEntries);
        }
        if (patch.topicsToAvoid !== undefined) row.topicsToAvoid = patch.topicsToAvoid ?? null;
        if (patch.capabilityLimits !== undefined) row.capabilityLimits = patch.capabilityLimits ?? null;
        if (patch.useListingDataForTopics !== undefined) {
            row.useListingDataForTopics = stringifyList(patch.useListingDataForTopics);
        }
        if (patch.airbnbSupportRules !== undefined) row.airbnbSupportRules = patch.airbnbSupportRules ?? null;
        if (patch.baseReplyStyleRules !== undefined) row.baseReplyStyleRules = patch.baseReplyStyleRules ?? null;
        if (patch.airbnbSupportBaseRules !== undefined) row.airbnbSupportBaseRules = patch.airbnbSupportBaseRules ?? null;
        if (patch.inquirySalesBaseRules !== undefined) row.inquirySalesBaseRules = patch.inquirySalesBaseRules ?? null;
        if (patch.selfServiceTroubleshootingRules !== undefined) {
            row.selfServiceTroubleshootingRules = patch.selfServiceTroubleshootingRules ?? null;
        }
        if (patch.quoSmsRules !== undefined) row.quoSmsRules = patch.quoSmsRules ?? null;
        if (patch.quoPmClientRules !== undefined) row.quoPmClientRules = patch.quoPmClientRules ?? null;
        if (patch.quoUnlinkedThreadRules !== undefined) row.quoUnlinkedThreadRules = patch.quoUnlinkedThreadRules ?? null;
        if (patch.autoRespondEnabled !== undefined) row.autoRespondEnabled = patch.autoRespondEnabled ? 1 : 0;
        if (patch.quoAutoRespondEnabled !== undefined) row.quoAutoRespondEnabled = patch.quoAutoRespondEnabled ? 1 : 0;
        if (patch.autosendMinConfidence !== undefined && Number.isFinite(patch.autosendMinConfidence)) {
            row.autosendMinConfidence = Math.max(0, Math.min(100, Math.round(patch.autosendMinConfidence)));
        }
        if (patch.autosendChannels !== undefined) row.autosendChannels = patch.autosendChannels ? String(patch.autosendChannels).slice(0, 255) : null;
        if (patch.autosendTierEnabled !== undefined) row.autosendTierEnabled = patch.autosendTierEnabled ? 1 : 0;
        if (patch.autosendInstantMinConfidence !== undefined && Number.isFinite(patch.autosendInstantMinConfidence)) {
            row.autosendInstantMinConfidence = Math.max(0, Math.min(100, Math.round(patch.autosendInstantMinConfidence)));
        }
        if (patch.autosendDelayedMinConfidence !== undefined && Number.isFinite(patch.autosendDelayedMinConfidence)) {
            row.autosendDelayedMinConfidence = Math.max(0, Math.min(100, Math.round(patch.autosendDelayedMinConfidence)));
        }
        if (patch.autosendDelayMinutes !== undefined && Number.isFinite(patch.autosendDelayMinutes)) {
            row.autosendDelayMinutes = Math.max(1, Math.min(120, Math.round(patch.autosendDelayMinutes)));
        }
        if (patch.inquirySalesRules !== undefined) row.inquirySalesRules = patch.inquirySalesRules ?? null;
        if (patch.inquiryAutoRespondEnabled !== undefined) row.inquiryAutoRespondEnabled = patch.inquiryAutoRespondEnabled ? 1 : 0;
        if (patch.selfServiceTroubleshootingEnabled !== undefined) row.selfServiceTroubleshootingEnabled = patch.selfServiceTroubleshootingEnabled ? 1 : 0;
        if (patch.paymentAlertEmails !== undefined) row.paymentAlertEmails = patch.paymentAlertEmails ?? null;
        if (patch.opsAlertEmails !== undefined) row.opsAlertEmails = patch.opsAlertEmails ?? null;
        if (patch.itemDetectionEnabled !== undefined) row.itemDetectionEnabled = patch.itemDetectionEnabled ? 1 : 0;
        if (patch.actionItemRules !== undefined) row.actionItemRules = patch.actionItemRules ?? null;
        if (patch.actionItemCategories !== undefined) {
            row.actionItemCategories = stringifyList(patch.actionItemCategories);
        }
        if (patch.guestIssueRules !== undefined) row.guestIssueRules = patch.guestIssueRules ?? null;
        if (patch.guestIssueCategories !== undefined) {
            row.guestIssueCategories = stringifyList(patch.guestIssueCategories);
        }
        if (patch.ticketCategories !== undefined) {
            row.ticketCategories = stringifyList(patch.ticketCategories);
        }
        if (patch.detectionFeedback !== undefined) row.detectionFeedback = patch.detectionFeedback ?? null;
        if (patch.proposedActionsEnabled !== undefined) row.proposedActionsEnabled = patch.proposedActionsEnabled ? 1 : 0;
        if (patch.proposedActionInstructions !== undefined) row.proposedActionInstructions = patch.proposedActionInstructions ?? null;
        if (patch.proposedActionApproveInstructions !== undefined) {
            row.proposedActionApproveInstructions = patch.proposedActionApproveInstructions ?? null;
        }
        if (patch.proposedActionApproveSendInstructions !== undefined) {
            row.proposedActionApproveSendInstructions = patch.proposedActionApproveSendInstructions ?? null;
        }

        // Admin-only instruction overrides. `instructionsEdited` is set by the
        // controller *only* after verifyAdmin has passed; the audit stamp is
        // written only when at least one of these fields actually changed.
        let instructionTouched = false;
        if (patch.detectorSystemPersona !== undefined) {
            row.detectorSystemPersona = patch.detectorSystemPersona
                ? String(patch.detectorSystemPersona)
                : null;
            instructionTouched = true;
        }
        if (patch.detectionExclusionRules !== undefined) {
            row.detectionExclusionRules = patch.detectionExclusionRules
                ? String(patch.detectionExclusionRules)
                : null;
            instructionTouched = true;
        }
        if (patch.detectionConfidenceFloor !== undefined) {
            if (patch.detectionConfidenceFloor === null || !Number.isFinite(patch.detectionConfidenceFloor)) {
                row.detectionConfidenceFloor = null;
            } else {
                const clamped = Math.max(0, Math.min(1, Number(patch.detectionConfidenceFloor)));
                row.detectionConfidenceFloor = clamped.toFixed(2);
            }
            instructionTouched = true;
        }
        if (patch.quoDetectorSystemPrompt !== undefined) {
            row.quoDetectorSystemPrompt = patch.quoDetectorSystemPrompt
                ? String(patch.quoDetectorSystemPrompt)
                : null;
            instructionTouched = true;
        }
        if (patch.betaDetectorSystemPrompt !== undefined) {
            row.betaDetectorSystemPrompt = patch.betaDetectorSystemPrompt
                ? String(patch.betaDetectorSystemPrompt)
                : null;
            instructionTouched = true;
        }
        if (instructionTouched && patch.instructionsEdited) {
            row.instructionsUpdatedAt = new Date();
            if (patch.userName != null) row.instructionsUpdatedByName = patch.userName;
        }

        if (patch.userId != null) row.updatedByUserId = patch.userId;
        if (patch.userName != null) row.updatedByName = patch.userName;
        const saved = await this.repo.save(row);
        if (Array.isArray(patch.quoLineAutoRespond)) {
            const updates = patch.quoLineAutoRespond
                .map((item) => ({
                    phoneNumberId: String(item?.phoneNumberId || "").trim(),
                    enabled: Boolean(item?.enabled),
                }))
                .filter((item) => item.phoneNumberId);
            for (const item of updates) {
                await this.quoLineRepo.update(
                    { phoneNumberId: item.phoneNumberId },
                    { aiAutoRespondEnabled: item.enabled ? 1 : 0 }
                );
            }
        }
        AIMessagingSettingsService.cache = saved;
        AIMessagingSettingsService.cacheAt = Date.now();
        logger.info(`[AIMessagingSettings] updated (hostifyAutoRespond=${saved.autoRespondEnabled}, quoAutoRespond=${saved.quoAutoRespondEnabled}, tone=${saved.tone})`);
        return saved;
    }

    async listQuoAutoRespondLines(): Promise<QuoPhoneLineEntity[]> {
        return this.quoLineRepo.find({
            order: { enabled: "DESC", category: "ASC", name: "ASC" },
        });
    }

    async isQuoLineAutoRespondEnabled(phoneNumberId: string): Promise<boolean> {
        const id = String(phoneNumberId || "").trim();
        if (!id) return false;
        const line = await this.quoLineRepo.findOne({ where: { phoneNumberId: id } });
        return Boolean(line?.aiAutoRespondEnabled);
    }

    /** Invalidate the cache (used after external writes). */
    static bustCache() {
        AIMessagingSettingsService.cache = null;
        AIMessagingSettingsService.cacheAt = 0;
    }
}
