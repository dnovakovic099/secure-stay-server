import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIMessagingSettingsEntity } from "../entity/AIMessagingSettings";

export interface AIMessagingSettingsPatch {
    tone?: string | null;
    communicationRules?: string | null;
    topicsToAvoid?: string | null;
    airbnbSupportRules?: string | null;
    autoRespondEnabled?: boolean;
    autosendMinConfidence?: number;
    autosendChannels?: string | null;
    itemDetectionEnabled?: boolean;
    actionItemRules?: string | null;
    guestIssueRules?: string | null;
    detectionFeedback?: string | null;
    userId?: number | null;
    userName?: string | null;
}

/**
 * Global (single-row) settings for the inbox AI assistant. Cached briefly to
 * avoid a DB hit on every suggestion/webhook while still reflecting UI changes
 * within a few seconds.
 */
export class AIMessagingSettingsService {
    private repo = appDatabase.getRepository(AIMessagingSettingsEntity);

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
        if (patch.topicsToAvoid !== undefined) row.topicsToAvoid = patch.topicsToAvoid ?? null;
        if (patch.airbnbSupportRules !== undefined) row.airbnbSupportRules = patch.airbnbSupportRules ?? null;
        if (patch.autoRespondEnabled !== undefined) row.autoRespondEnabled = patch.autoRespondEnabled ? 1 : 0;
        if (patch.autosendMinConfidence !== undefined && Number.isFinite(patch.autosendMinConfidence)) {
            row.autosendMinConfidence = Math.max(0, Math.min(100, Math.round(patch.autosendMinConfidence)));
        }
        if (patch.autosendChannels !== undefined) row.autosendChannels = patch.autosendChannels ? String(patch.autosendChannels).slice(0, 255) : null;
        if (patch.itemDetectionEnabled !== undefined) row.itemDetectionEnabled = patch.itemDetectionEnabled ? 1 : 0;
        if (patch.actionItemRules !== undefined) row.actionItemRules = patch.actionItemRules ?? null;
        if (patch.guestIssueRules !== undefined) row.guestIssueRules = patch.guestIssueRules ?? null;
        if (patch.detectionFeedback !== undefined) row.detectionFeedback = patch.detectionFeedback ?? null;
        if (patch.userId != null) row.updatedByUserId = patch.userId;
        if (patch.userName != null) row.updatedByName = patch.userName;
        const saved = await this.repo.save(row);
        AIMessagingSettingsService.cache = saved;
        AIMessagingSettingsService.cacheAt = Date.now();
        logger.info(`[AIMessagingSettings] updated (autoRespond=${saved.autoRespondEnabled}, tone=${saved.tone})`);
        return saved;
    }

    /** Invalidate the cache (used after external writes). */
    static bustCache() {
        AIMessagingSettingsService.cache = null;
        AIMessagingSettingsService.cacheAt = 0;
    }
}
