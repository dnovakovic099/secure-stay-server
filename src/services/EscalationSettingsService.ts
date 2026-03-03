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
            if (error.message?.includes('does not exist') || error.code === '42P01') {
                logger.info('[EscalationSettingsService] Creating escalation_settings table...');
                await appDatabase.query(`
                    CREATE TABLE escalation_settings (
                        id SERIAL PRIMARY KEY,
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
                        updated_by INT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        try {
            // Add slack_channel column if not exists
            await appDatabase.query(`
                ALTER TABLE escalation_settings 
                ADD COLUMN IF NOT EXISTS slack_channel VARCHAR(100)
            `);
            // Add event_type column if not exists
            await appDatabase.query(`
                ALTER TABLE escalation_settings 
                ADD COLUMN IF NOT EXISTS event_type VARCHAR(100)
            `);
        } catch (error) {
            // Ignore errors (column might already exist in some DBs)
            logger.debug('[EscalationSettingsService] Column migration check completed');
        }
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
        await this.ensureTable();
        
        const settings = await this.settingsRepo.find({
            order: { settingKey: 'ASC' }
        });

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
