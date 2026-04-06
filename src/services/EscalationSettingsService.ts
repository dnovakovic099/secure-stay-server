import logger from '../utils/logger.utils';
import { appDatabase } from '../utils/database.util';
import { EscalationSettings } from '../entity/EscalationSettings';
import { Employee, EmployeeDepartment } from '../entity/Employee';
import { UsersEntity } from '../entity/Users';

interface UpdateSettingsDto {
    overdueThresholdHours?: number;
    reminderIntervalHours?: number;
    dailyReminderTime?: string;
    primaryEmployeeId?: number | null;
    fallbackSlackGroupId?: string;
    checkShiftSchedule?: boolean;
    isActive?: boolean;
    displayName?: string | null;
    // AI settings
    aiEnabled?: boolean;
    aiMode?: string;
    aiInstructions?: string | null;
    readSlackReplies?: boolean;
    useConversationContext?: boolean;
    replyWhenTagged?: boolean;
    countAcknowledgmentAsActivity?: boolean;
    requireActionableResponses?: boolean;
    useAIForDecisions?: boolean;
    minFollowUpMinutes?: number;
    maxFollowUpMinutes?: number;
    allowAIAdjustTiming?: boolean;
    urgencyOverridesTiming?: boolean;
    evaluateAcknowledgment?: boolean;
    evaluateVagueReply?: boolean;
    evaluateEta?: boolean;
    evaluateActionableUpdate?: boolean;
    evaluateCompletion?: boolean;
    enableCompletionReview?: boolean;
    requireClearResolution?: boolean;
    askForMissingDetails?: boolean;
    escalateWeakCompletion?: boolean;
    suppressGenericMessages?: boolean;
    allowPositiveReinforcement?: boolean;
    managerTagSerious?: string | null;
    managerTagNeglect?: string | null;
    managerTagBadCompletion?: string | null;
    neglectThreshold?: number;
    immediateEscalation?: boolean;
    vagueReplyEscalation?: boolean;
    onlyFollowUpOnShift?: boolean;
    delayIfOffShift?: boolean;
    escalateUrgentOffShift?: boolean;
    fallbackTimingMinutes?: number;
    toneStyle?: string;
    encourageClarity?: boolean;
    pushForNextSteps?: boolean;
    avoidFillerMessages?: boolean;
}

interface SettingsWithEmployeeInfo extends EscalationSettings {
    primaryEmployee?: {
        id: number;
        name: string;
        slackUserId: string | null;
        schedule: string | null;
    } | null;
}

export class EscalationSettingsService {
    private settingsRepo = appDatabase.getRepository(EscalationSettings);
    private employeeRepo = appDatabase.getRepository(Employee);

    /**
     * Initialize the settings table and create default settings if needed
     */
    async ensureTable(): Promise<void> {
        try {
            // Check if table exists
            await appDatabase.query(`SELECT 1 FROM escalation_settings LIMIT 1`);
            
            // Ensure new columns exist (for migrations)
            await this.ensureColumns();
        } catch (error: any) {
            // Table doesn't exist, create it
            // Error code for "Table doesn't exist" in MySQL/MariaDB is usually 'ER_NO_SUCH_TABLE' or message contains 'doesn't exist'
            const isTableMissing =
                error.message?.toLowerCase().includes("doesn't exist") ||
                error.message?.toLowerCase().includes("does not exist") ||
                error.code === '42P01' || // PostgreSQL
                error.code === 'ER_NO_SUCH_TABLE'; // MySQL

            if (isTableMissing) {
                logger.info('[EscalationSettingsService] Creating escalation_settings table...');
                await appDatabase.query(`
                    CREATE TABLE IF NOT EXISTS escalation_settings (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        setting_key VARCHAR(100) NOT NULL UNIQUE,
                        display_name VARCHAR(255),
                        slack_channel VARCHAR(100),
                        event_type VARCHAR(100),
                        overdue_threshold_hours INT NOT NULL DEFAULT 4,
                        reminder_interval_hours INT NOT NULL DEFAULT 1,
                        daily_reminder_time VARCHAR(10) NOT NULL DEFAULT '10:00',
                        primary_employee_id INT,
                        fallback_slack_group_id VARCHAR(50) NOT NULL DEFAULT 'S09AUHMA6HE',
                        check_shift_schedule BOOLEAN NOT NULL DEFAULT true,
                        is_active BOOLEAN NOT NULL DEFAULT true,
                        ai_enabled BOOLEAN NOT NULL DEFAULT true,
                        ai_instructions TEXT,
                        ai_mode VARCHAR(20) DEFAULT 'standard',
                        updated_by INT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    )
                `);
                logger.info('[EscalationSettingsService] Table created successfully');
            } else {
                throw error;
            }
        }

        // Ensure default settings exist
        await this.ensureDefaultSettings();
    }

    /**
     * Ensure new columns exist (for migrations)
     */
    private async ensureColumns(): Promise<void> {
        const columns = [
            { name: 'slack_channel', sql: 'ADD COLUMN IF NOT EXISTS slack_channel VARCHAR(100)' },
            { name: 'event_type', sql: 'ADD COLUMN IF NOT EXISTS event_type VARCHAR(100)' },
            { name: 'ai_enabled', sql: 'ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN DEFAULT true' },
            { name: 'ai_instructions', sql: 'ADD COLUMN IF NOT EXISTS ai_instructions TEXT' },
            { name: 'ai_mode', sql: "ADD COLUMN IF NOT EXISTS ai_mode VARCHAR(20) DEFAULT 'standard'" },
            { name: 'read_slack_replies', sql: 'ADD COLUMN IF NOT EXISTS read_slack_replies BOOLEAN DEFAULT true' },
            { name: 'use_conversation_context', sql: 'ADD COLUMN IF NOT EXISTS use_conversation_context BOOLEAN DEFAULT true' },
            { name: 'reply_when_tagged', sql: 'ADD COLUMN IF NOT EXISTS reply_when_tagged BOOLEAN DEFAULT true' },
            { name: 'count_acknowledgment_as_activity', sql: 'ADD COLUMN IF NOT EXISTS count_acknowledgment_as_activity BOOLEAN DEFAULT true' },
            { name: 'require_actionable_responses', sql: 'ADD COLUMN IF NOT EXISTS require_actionable_responses BOOLEAN DEFAULT false' },
            { name: 'use_ai_for_decisions', sql: 'ADD COLUMN IF NOT EXISTS use_ai_for_decisions BOOLEAN DEFAULT true' },
            { name: 'min_follow_up_minutes', sql: 'ADD COLUMN IF NOT EXISTS min_follow_up_minutes INT DEFAULT 30' },
            { name: 'max_follow_up_minutes', sql: 'ADD COLUMN IF NOT EXISTS max_follow_up_minutes INT DEFAULT 480' },
            { name: 'allow_ai_adjust_timing', sql: 'ADD COLUMN IF NOT EXISTS allow_ai_adjust_timing BOOLEAN DEFAULT true' },
            { name: 'urgency_overrides_timing', sql: 'ADD COLUMN IF NOT EXISTS urgency_overrides_timing BOOLEAN DEFAULT true' },
            { name: 'evaluate_acknowledgment', sql: 'ADD COLUMN IF NOT EXISTS evaluate_acknowledgment BOOLEAN DEFAULT true' },
            { name: 'evaluate_vague_reply', sql: 'ADD COLUMN IF NOT EXISTS evaluate_vague_reply BOOLEAN DEFAULT true' },
            { name: 'evaluate_eta', sql: 'ADD COLUMN IF NOT EXISTS evaluate_eta BOOLEAN DEFAULT true' },
            { name: 'evaluate_actionable_update', sql: 'ADD COLUMN IF NOT EXISTS evaluate_actionable_update BOOLEAN DEFAULT true' },
            { name: 'evaluate_completion', sql: 'ADD COLUMN IF NOT EXISTS evaluate_completion BOOLEAN DEFAULT true' },
            { name: 'enable_completion_review', sql: 'ADD COLUMN IF NOT EXISTS enable_completion_review BOOLEAN DEFAULT true' },
            { name: 'require_clear_resolution', sql: 'ADD COLUMN IF NOT EXISTS require_clear_resolution BOOLEAN DEFAULT true' },
            { name: 'ask_for_missing_details', sql: 'ADD COLUMN IF NOT EXISTS ask_for_missing_details BOOLEAN DEFAULT true' },
            { name: 'escalate_weak_completion', sql: 'ADD COLUMN IF NOT EXISTS escalate_weak_completion BOOLEAN DEFAULT false' },
            { name: 'suppress_generic_messages', sql: 'ADD COLUMN IF NOT EXISTS suppress_generic_messages BOOLEAN DEFAULT true' },
            { name: 'allow_positive_reinforcement', sql: 'ADD COLUMN IF NOT EXISTS allow_positive_reinforcement BOOLEAN DEFAULT true' },
            { name: 'manager_tag_serious', sql: 'ADD COLUMN IF NOT EXISTS manager_tag_serious VARCHAR(50)' },
            { name: 'manager_tag_neglect', sql: 'ADD COLUMN IF NOT EXISTS manager_tag_neglect VARCHAR(50)' },
            { name: 'manager_tag_bad_completion', sql: 'ADD COLUMN IF NOT EXISTS manager_tag_bad_completion VARCHAR(50)' },
            { name: 'neglect_threshold', sql: 'ADD COLUMN IF NOT EXISTS neglect_threshold INT DEFAULT 2' },
            { name: 'immediate_escalation', sql: 'ADD COLUMN IF NOT EXISTS immediate_escalation BOOLEAN DEFAULT false' },
            { name: 'vague_reply_escalation', sql: 'ADD COLUMN IF NOT EXISTS vague_reply_escalation BOOLEAN DEFAULT false' },
            { name: 'only_follow_up_on_shift', sql: 'ADD COLUMN IF NOT EXISTS only_follow_up_on_shift BOOLEAN DEFAULT false' },
            { name: 'delay_if_off_shift', sql: 'ADD COLUMN IF NOT EXISTS delay_if_off_shift BOOLEAN DEFAULT true' },
            { name: 'escalate_urgent_off_shift', sql: 'ADD COLUMN IF NOT EXISTS escalate_urgent_off_shift BOOLEAN DEFAULT true' },
            { name: 'fallback_timing_minutes', sql: 'ADD COLUMN IF NOT EXISTS fallback_timing_minutes INT DEFAULT 60' },
            { name: 'tone_style', sql: "ADD COLUMN IF NOT EXISTS tone_style VARCHAR(50) DEFAULT 'supportive_firm'" },
            { name: 'encourage_clarity', sql: 'ADD COLUMN IF NOT EXISTS encourage_clarity BOOLEAN DEFAULT true' },
            { name: 'push_for_next_steps', sql: 'ADD COLUMN IF NOT EXISTS push_for_next_steps BOOLEAN DEFAULT true' },
            { name: 'avoid_filler_messages', sql: 'ADD COLUMN IF NOT EXISTS avoid_filler_messages BOOLEAN DEFAULT true' },
        ];

        for (const col of columns) {
            try {
                await appDatabase.query(`ALTER TABLE escalation_settings ${col.sql}`);
            } catch (error: any) {
                // Column might already exist (for DBs that don't support IF NOT EXISTS)
                if (!error.message?.includes('already exists') && !error.message?.includes('duplicate column')) {
                    logger.warn(`[EscalationSettingsService] Failed to add column ${col.name}:`, error.message);
                }
            }
        }
        
        logger.debug('[EscalationSettingsService] Column migration check completed');
    }

    /**
     * Create default settings if they don't exist
     */
    private async ensureDefaultSettings(): Promise<void> {
        const defaultExists = await this.settingsRepo.findOne({ where: { settingKey: 'default' } });
        
        if (!defaultExists) {
            logger.info('[EscalationSettingsService] Creating default escalation settings...');
            await this.settingsRepo.save({
                settingKey: 'default',
                displayName: 'Default Settings',
                overdueThresholdHours: 4,
                reminderIntervalHours: 1,
                dailyReminderTime: '10:00',
                primaryEmployeeId: null,
                fallbackSlackGroupId: 'S09AUHMA6HE',
                checkShiftSchedule: true,
                isActive: true,
            });
        }

        // Check if all-channel-support-messages setting exists
        const allChannelExists = await this.settingsRepo.findOne({ 
            where: { settingKey: 'all-channel-support-messages' } 
        });
        
        if (!allChannelExists) {
            logger.info('[EscalationSettingsService] Creating all-channel-support-messages settings...');
            
            // Try to find Kaz to set as primary employee
            let kazEmployeeId: number | null = null;
            try {
                const kaz = await this.employeeRepo
                    .createQueryBuilder('emp')
                    .leftJoinAndSelect('emp.user', 'user')
                    .where('emp.department = :dept', { dept: EmployeeDepartment.GUEST_RELATIONS })
                    .andWhere('emp.isActive = :active', { active: true })
                    .andWhere("(LOWER(user.firstName) LIKE :name OR LOWER(user.lastName) LIKE :name OR LOWER(CONCAT(user.firstName, ' ', user.lastName)) LIKE :name)", { name: '%kaz%' })
                    .getOne();
                
                if (kaz) {
                    kazEmployeeId = kaz.id;
                }
            } catch (error) {
                logger.warn('[EscalationSettingsService] Could not find Kaz employee:', error);
            }

            await this.settingsRepo.save({
                settingKey: 'all-channel-support-messages',
                displayName: 'All Channel Support Messages',
                overdueThresholdHours: 4,
                reminderIntervalHours: 1,
                dailyReminderTime: '10:00',
                primaryEmployeeId: kazEmployeeId,
                fallbackSlackGroupId: 'S09AUHMA6HE',
                checkShiftSchedule: true,
                isActive: true,
            });
        }
    }

    /**
     * Get all escalation settings
     */
    async getAllSettings(): Promise<SettingsWithEmployeeInfo[]> {
        // Always use raw query to avoid TypeORM column sync issues
        let settings: EscalationSettings[];
        
        try {
            // Ensure table and columns exist first
            await this.ensureTable();
        } catch (tableError) {
            logger.error('[EscalationSettingsService] Error ensuring table:', tableError);
        }

        try {
            // Use raw query - more robust than TypeORM when columns might be missing
            const rawSettings = await appDatabase.query('SELECT * FROM escalation_settings ORDER BY setting_key ASC');
            settings = rawSettings.map((row: any) => ({
                id: row.id,
                settingKey: row.setting_key,
                displayName: row.display_name,
                slackChannel: row.slack_channel,
                eventType: row.event_type,
                overdueThresholdHours: row.overdue_threshold_hours || 4,
                reminderIntervalHours: row.reminder_interval_hours || 1,
                dailyReminderTime: row.daily_reminder_time || '10:00',
                primaryEmployeeId: row.primary_employee_id,
                fallbackSlackGroupId: row.fallback_slack_group_id || 'S09AUHMA6HE',
                checkShiftSchedule: row.check_shift_schedule ?? true,
                isActive: row.is_active ?? true,
                aiEnabled: row.ai_enabled ?? true,
                aiInstructions: row.ai_instructions ?? null,
                aiMode: row.ai_mode ?? 'standard',
                readSlackReplies: row.read_slack_replies ?? true,
                useConversationContext: row.use_conversation_context ?? true,
                replyWhenTagged: row.reply_when_tagged ?? true,
                countAcknowledgmentAsActivity: row.count_acknowledgment_as_activity ?? true,
                requireActionableResponses: row.require_actionable_responses ?? false,
                useAIForDecisions: row.use_ai_for_decisions ?? true,
                minFollowUpMinutes: row.min_follow_up_minutes ?? 30,
                maxFollowUpMinutes: row.max_follow_up_minutes ?? 480,
                allowAIAdjustTiming: row.allow_ai_adjust_timing ?? true,
                urgencyOverridesTiming: row.urgency_overrides_timing ?? true,
                evaluateAcknowledgment: row.evaluate_acknowledgment ?? true,
                evaluateVagueReply: row.evaluate_vague_reply ?? true,
                evaluateEta: row.evaluate_eta ?? true,
                evaluateActionableUpdate: row.evaluate_actionable_update ?? true,
                evaluateCompletion: row.evaluate_completion ?? true,
                enableCompletionReview: row.enable_completion_review ?? true,
                requireClearResolution: row.require_clear_resolution ?? true,
                askForMissingDetails: row.ask_for_missing_details ?? true,
                escalateWeakCompletion: row.escalate_weak_completion ?? false,
                suppressGenericMessages: row.suppress_generic_messages ?? true,
                allowPositiveReinforcement: row.allow_positive_reinforcement ?? true,
                managerTagSerious: row.manager_tag_serious ?? null,
                managerTagNeglect: row.manager_tag_neglect ?? null,
                managerTagBadCompletion: row.manager_tag_bad_completion ?? null,
                neglectThreshold: row.neglect_threshold ?? 2,
                immediateEscalation: row.immediate_escalation ?? false,
                vagueReplyEscalation: row.vague_reply_escalation ?? false,
                onlyFollowUpOnShift: row.only_follow_up_on_shift ?? false,
                delayIfOffShift: row.delay_if_off_shift ?? true,
                escalateUrgentOffShift: row.escalate_urgent_off_shift ?? true,
                fallbackTimingMinutes: row.fallback_timing_minutes ?? 60,
                toneStyle: row.tone_style ?? 'supportive_firm',
                encourageClarity: row.encourage_clarity ?? true,
                pushForNextSteps: row.push_for_next_steps ?? true,
                avoidFillerMessages: row.avoid_filler_messages ?? true,
                updatedBy: row.updated_by,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            } as EscalationSettings));
            
            logger.info(`[EscalationSettingsService] Loaded ${settings.length} settings`);
        } catch (queryError: any) {
            logger.error('[EscalationSettingsService] Error querying settings:', queryError);
            // Return empty array instead of throwing
            settings = [];
        }

        // Enrich with employee info
        const enrichedSettings: SettingsWithEmployeeInfo[] = [];
        
        for (const setting of settings) {
            const enriched: SettingsWithEmployeeInfo = { ...setting };
            
            if (setting.primaryEmployeeId) {
                try {
                    const employee = await this.employeeRepo.findOne({
                        where: { id: setting.primaryEmployeeId },
                        relations: ['user']
                    });
                    
                    if (employee) {
                        enriched.primaryEmployee = {
                            id: employee.id,
                            name: employee.user ? `${employee.user.firstName || ''} ${employee.user.lastName || ''}`.trim() || 'Unknown' : 'Unknown',
                            slackUserId: employee.slackUserId || employee.slackId,
                            schedule: employee.schedule
                        };
                    }
                } catch (error) {
                    logger.warn(`[EscalationSettingsService] Could not fetch employee ${setting.primaryEmployeeId}:`, error);
                }
            }
            
            enrichedSettings.push(enriched);
        }

        return enrichedSettings;
    }

    /**
     * Get settings for a specific key (channel)
     */
    async getSettingsByKey(key: string): Promise<SettingsWithEmployeeInfo | null> {
        await this.ensureTable();
        
        let setting = await this.settingsRepo.findOne({ where: { settingKey: key } });
        
        // Fall back to default if not found
        if (!setting) {
            setting = await this.settingsRepo.findOne({ where: { settingKey: 'default' } });
        }
        
        if (!setting) return null;

        const enriched: SettingsWithEmployeeInfo = { ...setting };
        
        if (setting.primaryEmployeeId) {
            try {
                const employee = await this.employeeRepo.findOne({
                    where: { id: setting.primaryEmployeeId },
                    relations: ['user']
                });
                
                if (employee) {
                    enriched.primaryEmployee = {
                        id: employee.id,
                        name: employee.user ? `${employee.user.firstName || ''} ${employee.user.lastName || ''}`.trim() || 'Unknown' : 'Unknown',
                        slackUserId: employee.slackUserId || employee.slackId,
                        schedule: employee.schedule
                    };
                }
            } catch (error) {
                logger.warn(`[EscalationSettingsService] Could not fetch employee ${setting.primaryEmployeeId}:`, error);
            }
        }

        return enriched;
    }

    /**
     * Update settings for a specific key
     */
    async updateSettings(key: string, updates: UpdateSettingsDto, updatedByUserId?: number): Promise<EscalationSettings> {
        await this.ensureTable();
        
        let setting = await this.settingsRepo.findOne({ where: { settingKey: key } });
        
        if (!setting) {
            // Create new setting if it doesn't exist
            setting = this.settingsRepo.create({
                settingKey: key,
                ...updates,
                updatedBy: updatedByUserId || null
            });
        } else {
            // Update existing
            Object.assign(setting, updates);
            setting.updatedBy = updatedByUserId || null;
        }

        return this.settingsRepo.save(setting);
    }

    /**
     * Get list of GR employees for dropdown
     */
    async getGREmployees(): Promise<Array<{ id: number; name: string; slackUserId: string | null; schedule: string | null }>> {
        const employees = await this.employeeRepo.find({
            where: { 
                department: EmployeeDepartment.GUEST_RELATIONS,
                isActive: true 
            },
            relations: ['user'],
            order: { id: 'ASC' }
        });

        return employees.map(emp => ({
            id: emp.id,
            name: emp.user ? `${emp.user.firstName || ''} ${emp.user.lastName || ''}`.trim() || `Employee #${emp.id}` : `Employee #${emp.id}`,
            slackUserId: emp.slackUserId || emp.slackId,
            schedule: emp.schedule
        }));
    }

    /**
     * Create a new settings entry
     */
    async createSettings(key: string, data: UpdateSettingsDto, updatedByUserId?: number): Promise<EscalationSettings> {
        await this.ensureTable();

        const existing = await this.settingsRepo.findOne({ where: { settingKey: key } });
        if (existing) {
            throw new Error(`Settings with key '${key}' already exists`);
        }

        const setting = this.settingsRepo.create({
            settingKey: key,
            ...data,
            updatedBy: updatedByUserId || null
        });

        return this.settingsRepo.save(setting);
    }

    /**
     * Delete a settings entry (cannot delete 'default')
     */
    async deleteSettings(key: string): Promise<void> {
        if (key === 'default') {
            throw new Error('Cannot delete default settings');
        }

        await this.settingsRepo.delete({ settingKey: key });
    }
}
