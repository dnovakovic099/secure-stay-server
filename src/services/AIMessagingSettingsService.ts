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

const randomRuleId = () => Math.random().toString(36).slice(2, 10);

/** Parse Settings JSON array of per-topic communication rules. */
export function parseCommunicationRuleEntries(raw: string | null | undefined): CommunicationRuleEntry[] {
    if (!raw || !String(raw).trim()) return [];
    try {
        const parsed = JSON.parse(String(raw));
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((e: any) => ({
                id: String(e?.id || randomRuleId()),
                topic: String(e?.topic || "").trim(),
                rule: String(e?.rule || "").trim(),
                appliesTo: e?.appliesTo != null && String(e.appliesTo).trim() ? String(e.appliesTo).trim() : null,
            }))
            .filter((e) => e.topic && e.rule);
    } catch {
        return [];
    }
}

/** Format per-topic entries for the TEAM COMMUNICATION RULES prompt block. */
export function formatCommunicationRuleEntriesForPrompt(entries: CommunicationRuleEntry[]): string {
    if (!entries.length) return "";
    return entries
        .map((e) => {
            const scope = e.appliesTo ? ` (${e.appliesTo})` : "";
            return `- [${e.topic}]${scope}: ${e.rule}`;
        })
        .join("\n");
}

/**
 * Effective text injected as TEAM COMMUNICATION RULES.
 * Prefers structured entries; appends legacy free-text when both exist.
 */
export function buildTeamCommunicationRulesText(settings?: {
    communicationRules?: string | null;
    communicationRuleEntries?: string | null;
} | null): string {
    const fromEntries = formatCommunicationRuleEntriesForPrompt(
        parseCommunicationRuleEntries(settings?.communicationRuleEntries)
    );
    const fromFree = (settings?.communicationRules || "").trim();
    return [fromEntries, fromFree].filter(Boolean).join("\n\n");
}

export interface ActionItemCategoryEntry {
    id: string;
    name: string;
    description?: string | null;
    examples?: string | null;
    autoCreate?: boolean;
}

/** How inbox AI should handle early check-in / late check-out guest asks. */
export type EarlyLateCheckHandling = "defer_to_team" | "deny" | "quote_fee_and_defer" | "accept_with_fee";

const EARLY_LATE_HANDLING_VALUES: EarlyLateCheckHandling[] = [
    "defer_to_team",
    "deny",
    "quote_fee_and_defer",
    "accept_with_fee",
];

export function normalizeEarlyLateHandling(raw: any): EarlyLateCheckHandling {
    const v = String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    if ((EARLY_LATE_HANDLING_VALUES as string[]).includes(v)) return v as EarlyLateCheckHandling;
    return "defer_to_team";
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
    earlyCheckinHandling?: EarlyLateCheckHandling | string;
    lateCheckoutHandling?: EarlyLateCheckHandling | string;
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
    rescueCopilotEnabled?: boolean;
    rescueNotifyAnjEnabled?: boolean;
    rescueGestures?: string | null;
    rescueUnansweredMinutes?: number;
    irAutoAckEnabled?: boolean;
    irAutoAckListingIds?: string | null;
    irAutoAssignEnabled?: boolean;
    irStaleHoursInHouse?: number;
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

    /** Best-effort schema ensure for new policy columns (prod may lag migrations). */
    private static columnsEnsured = false;
    private async ensureEarlyLateColumns(): Promise<void> {
        if (AIMessagingSettingsService.columnsEnsured) return;
        try {
            const cols: any[] = await appDatabase.query(
                `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings'
                   AND COLUMN_NAME IN ('earlyCheckinHandling','lateCheckoutHandling')`
            );
            const have = new Set((cols || []).map((c) => String(c.name)));
            if (!have.has("earlyCheckinHandling")) {
                await appDatabase.query(
                    `ALTER TABLE ai_messaging_settings
                     ADD COLUMN earlyCheckinHandling VARCHAR(32) NOT NULL DEFAULT 'defer_to_team'`
                );
            }
            if (!have.has("lateCheckoutHandling")) {
                await appDatabase.query(
                    `ALTER TABLE ai_messaging_settings
                     ADD COLUMN lateCheckoutHandling VARCHAR(32) NOT NULL DEFAULT 'defer_to_team'`
                );
            }
            AIMessagingSettingsService.columnsEnsured = true;
        } catch (err: any) {
            logger.warn(`[AIMessagingSettings] ensureEarlyLateColumns: ${err?.message}`);
            AIMessagingSettingsService.columnsEnsured = true; // don't tight-loop on failure
        }
    }

    /** The single global settings row, created with defaults if missing. */
    async getGlobal(): Promise<AIMessagingSettingsEntity> {
        await this.ensureEarlyLateColumns();
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
                earlyCheckinHandling: "defer_to_team",
                lateCheckoutHandling: "defer_to_team",
            });
            row = await this.repo.save(row);
        }
        row.earlyCheckinHandling = normalizeEarlyLateHandling(row.earlyCheckinHandling);
        row.lateCheckoutHandling = normalizeEarlyLateHandling(row.lateCheckoutHandling);
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
        if (patch.earlyCheckinHandling !== undefined) {
            row.earlyCheckinHandling = normalizeEarlyLateHandling(patch.earlyCheckinHandling);
        }
        if (patch.lateCheckoutHandling !== undefined) {
            row.lateCheckoutHandling = normalizeEarlyLateHandling(patch.lateCheckoutHandling);
        }
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
        if (patch.rescueCopilotEnabled !== undefined) row.rescueCopilotEnabled = patch.rescueCopilotEnabled ? 1 : 0;
        if (patch.rescueNotifyAnjEnabled !== undefined) {
            row.rescueNotifyAnjEnabled = patch.rescueNotifyAnjEnabled ? 1 : 0;
        }
        if (patch.rescueGestures !== undefined) row.rescueGestures = patch.rescueGestures ?? null;
        if (patch.rescueUnansweredMinutes !== undefined && Number.isFinite(patch.rescueUnansweredMinutes)) {
            row.rescueUnansweredMinutes = Math.max(10, Math.min(240, Math.round(patch.rescueUnansweredMinutes)));
        }
        if (patch.irAutoAckEnabled !== undefined) row.irAutoAckEnabled = patch.irAutoAckEnabled ? 1 : 0;
        if (patch.irAutoAckListingIds !== undefined) row.irAutoAckListingIds = patch.irAutoAckListingIds ?? null;
        if (patch.irAutoAssignEnabled !== undefined) row.irAutoAssignEnabled = patch.irAutoAssignEnabled ? 1 : 0;
        if (patch.irStaleHoursInHouse !== undefined && Number.isFinite(patch.irStaleHoursInHouse)) {
            row.irStaleHoursInHouse = Math.max(1, Math.min(48, Math.round(patch.irStaleHoursInHouse)));
        }
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
