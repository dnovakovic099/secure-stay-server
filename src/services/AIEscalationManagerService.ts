import logger from '../utils/logger.utils';
import { appDatabase } from '../utils/database.util';
import { ZapierTriggerEvent } from '../entity/ZapierTriggerEvent';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import { Employee } from '../entity/Employee';
import { AIEscalationLog } from '../entity/AIEscalationLog';
import { EscalationSettingsService } from './EscalationSettingsService';
import sendSlackMessage from '../utils/sendSlackMsg';
import OpenAI from 'openai';
import axios from 'axios';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_GR_GROUP = 'S09AUHMA6HE';

interface AISettings {
    aiEnabled: boolean;
    aiMode: 'standard' | 'strict' | 'lenient';
    aiInstructions: string | null;
    readSlackReplies: boolean;
    useConversationContext: boolean;
    replyWhenTagged: boolean;
    countAcknowledgmentAsActivity: boolean;
    requireActionableResponses: boolean;
    useAIForDecisions: boolean;
    minFollowUpMinutes: number;
    maxFollowUpMinutes: number;
    allowAIAdjustTiming: boolean;
    urgencyOverridesTiming: boolean;
    evaluateAcknowledgment: boolean;
    evaluateVagueReply: boolean;
    evaluateEta: boolean;
    evaluateActionableUpdate: boolean;
    evaluateCompletion: boolean;
    enableCompletionReview: boolean;
    requireClearResolution: boolean;
    askForMissingDetails: boolean;
    escalateWeakCompletion: boolean;
    suppressGenericMessages: boolean;
    allowPositiveReinforcement: boolean;
    managerTagSerious: string | null;
    managerTagNeglect: string | null;
    managerTagBadCompletion: string | null;
    neglectThreshold: number;
    immediateEscalation: boolean;
    vagueReplyEscalation: boolean;
    onlyFollowUpOnShift: boolean;
    delayIfOffShift: boolean;
    escalateUrgentOffShift: boolean;
    fallbackTimingMinutes: number;
    toneStyle: string;
    encourageClarity: boolean;
    pushForNextSteps: boolean;
    avoidFillerMessages: boolean;
    primaryEmployeeId?: number | null;
    primaryEmployee?: {
        id: number;
        name: string;
        slackUserId: string | null;
        schedule: string | null;
    } | null;
    fallbackSlackGroupId?: string | null;
    checkShiftSchedule?: boolean;
}

type DecisionAction =
    | 'SKIP'
    | 'REMIND'
    | 'ASK_UPDATE'
    | 'ESCALATE'
    | 'AUTO_COMPLETE'
    | 'AUTO_IN_PROGRESS';

interface ThreadMessage {
    ts: string;
    user?: string;
    text: string;
    bot_id?: string;
    username?: string;
}

interface FeedbackRule {
    id: number;
    scope: string;
    comment: string;
    expectedBehavior: string | null;
    feedbackType: string | null;
    rating: string | null;
}

interface TaskContext {
    event: ZapierTriggerEvent;
    threadMessages: ThreadMessage[];
    latestHumanReplies: ThreadMessage[];
    hoursSinceCreation: number;
    hoursSinceLastActivity: number;
    reminderCount: number;
    neglectCount: number;
    vagueReplyCount: number;
    slackChannel?: string;
    aiSettings: AISettings;
    feedbackRules: FeedbackRule[];
    recentLogs: AIEscalationLog[];
    assignedRepName?: string | null;
    assignedRepSlackId?: string | null;
    assignedRepOnShift?: boolean | null;
    statusHistory: string[];
}

interface AIEvaluation {
    severityLevel: 'low' | 'medium' | 'high' | 'critical';
    repEngagementType: 'none' | 'acknowledgment' | 'vague' | 'actionable' | 'complete';
    neglectCount: number;
    urgencyScore: number;
    completionQuality: number;
    recommendedAction: DecisionAction;
    nextFollowUpTime: string | null;
    escalationRequired: boolean;
    reasoningSummary: string;
}

export interface AIDecision {
    action: DecisionAction;
    reason?: string;
    message?: string;
    mention?: string;
    escalateTo?: string;
    nextFollowUpAt?: Date | null;
    evaluation: AIEvaluation;
    rawResponse?: string;
}

interface CompletionReview {
    shouldSendMessage: boolean;
    message: string | null;
    completionQuality: number;
    reasoningSummary: string;
    escalateToManager: boolean;
}

/**
 * AI-powered Escalation Manager
 *
 * Behaves like an operations manager:
 * - Reads task and thread context
 * - Evaluates rep engagement quality
 * - Adapts follow-up timing dynamically
 * - Reuses manager feedback as guidance
 * - Explains what it saw and why it acted
 */
export class AIEscalationManagerService {
    private openai: OpenAI | null = null;
    private eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private employeeRepo = appDatabase.getRepository(Employee);
    private logRepo = appDatabase.getRepository(AIEscalationLog);
    private settingsService = new EscalationSettingsService();
    private schemaReady = false;

    private readonly MANAGER_PERSONAS: Record<string, string> = {
        standard: `You are an AI operations manager for a vacation rental property management company's Guest Relations team.

Your job is to read the full operational context, judge the quality of rep engagement, decide the next best action, and avoid noisy filler.
You are accountable, concise, and contextual. You act like a real manager, not a reminder bot.`,
        strict: `You are a strict AI operations manager for Guest Relations.

You prioritize guest risk, follow-up discipline, and accountability. Escalate earlier when neglect or vague replies continue.`,
        lenient: `You are a supportive AI operations manager for Guest Relations.

You still hold the line on guest outcomes, but you give more room for reasonable delays and useful rep updates.`
    };

    private getOpenAI(): OpenAI {
        if (!this.openai) {
            if (!OPENAI_API_KEY) {
                throw new Error('OPENAI_API_KEY is not set');
            }
            this.openai = new OpenAI({ apiKey: OPENAI_API_KEY });
        }
        return this.openai;
    }

    private async ensureSchema(): Promise<void> {
        if (this.schemaReady) return;

        const aiLogColumns = [
            ['severity_level', 'ADD COLUMN IF NOT EXISTS severity_level VARCHAR(20) NULL'],
            ['rep_engagement_type', 'ADD COLUMN IF NOT EXISTS rep_engagement_type VARCHAR(30) NULL'],
            ['neglect_count', 'ADD COLUMN IF NOT EXISTS neglect_count INT NOT NULL DEFAULT 0'],
            ['urgency_score', 'ADD COLUMN IF NOT EXISTS urgency_score FLOAT NULL'],
            ['completion_quality', 'ADD COLUMN IF NOT EXISTS completion_quality FLOAT NULL'],
            ['recommended_action', 'ADD COLUMN IF NOT EXISTS recommended_action VARCHAR(50) NULL'],
            ['next_follow_up_at', 'ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMP NULL'],
            ['escalation_required', 'ADD COLUMN IF NOT EXISTS escalation_required BOOLEAN NOT NULL DEFAULT false'],
            ['reasoning_summary', 'ADD COLUMN IF NOT EXISTS reasoning_summary TEXT NULL'],
            ['decision_input_summary', 'ADD COLUMN IF NOT EXISTS decision_input_summary TEXT NULL'],
            ['decision_payload', 'ADD COLUMN IF NOT EXISTS decision_payload MEDIUMTEXT NULL'],
            ['feedback_type', 'ADD COLUMN IF NOT EXISTS feedback_type VARCHAR(50) NULL'],
            ['feedback_scope', 'ADD COLUMN IF NOT EXISTS feedback_scope VARCHAR(50) NULL'],
            ['expected_behavior', 'ADD COLUMN IF NOT EXISTS expected_behavior TEXT NULL'],
            ['manager_comment', 'ADD COLUMN IF NOT EXISTS manager_comment TEXT NULL'],
        ];

        const taskColumns = [
            ['next_follow_up_at', 'ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMP NULL'],
            ['ignored_prompt_count', 'ADD COLUMN IF NOT EXISTS ignored_prompt_count INT NOT NULL DEFAULT 0'],
            ['vague_reply_count', 'ADD COLUMN IF NOT EXISTS vague_reply_count INT NOT NULL DEFAULT 0'],
            ['completion_quality_score', 'ADD COLUMN IF NOT EXISTS completion_quality_score FLOAT NULL'],
            ['last_ai_review_summary', 'ADD COLUMN IF NOT EXISTS last_ai_review_summary TEXT NULL'],
            ['last_ai_review_payload', 'ADD COLUMN IF NOT EXISTS last_ai_review_payload MEDIUMTEXT NULL'],
            ['last_ai_review_at', 'ADD COLUMN IF NOT EXISTS last_ai_review_at TIMESTAMP NULL'],
            ['assigned_rep_name', 'ADD COLUMN IF NOT EXISTS assigned_rep_name VARCHAR(255) NULL'],
            ['assigned_rep_slack_id', 'ADD COLUMN IF NOT EXISTS assigned_rep_slack_id VARCHAR(100) NULL'],
        ];

        for (const [, sql] of aiLogColumns) {
            try {
                await appDatabase.query(`ALTER TABLE ai_escalation_logs ${sql}`);
            } catch (error: any) {
                if (!error.message?.includes('already exists') && !error.message?.includes('duplicate column')) {
                    logger.warn('[AIEscalationManager] Failed to ensure ai_escalation_logs column:', error.message);
                }
            }
        }

        for (const [, sql] of taskColumns) {
            try {
                await appDatabase.query(`ALTER TABLE zapier_trigger_events ${sql}`);
            } catch (error: any) {
                if (!error.message?.includes('already exists') && !error.message?.includes('duplicate column')) {
                    logger.warn('[AIEscalationManager] Failed to ensure zapier_trigger_events column:', error.message);
                }
            }
        }

        this.schemaReady = true;
    }

    private getDefaultSettings(): AISettings {
        return {
            aiEnabled: true,
            aiMode: 'standard',
            aiInstructions: null,
            readSlackReplies: true,
            useConversationContext: true,
            replyWhenTagged: true,
            countAcknowledgmentAsActivity: true,
            requireActionableResponses: false,
            useAIForDecisions: true,
            minFollowUpMinutes: 30,
            maxFollowUpMinutes: 480,
            allowAIAdjustTiming: true,
            urgencyOverridesTiming: true,
            evaluateAcknowledgment: true,
            evaluateVagueReply: true,
            evaluateEta: true,
            evaluateActionableUpdate: true,
            evaluateCompletion: true,
            enableCompletionReview: true,
            requireClearResolution: true,
            askForMissingDetails: true,
            escalateWeakCompletion: false,
            suppressGenericMessages: true,
            allowPositiveReinforcement: true,
            managerTagSerious: null,
            managerTagNeglect: null,
            managerTagBadCompletion: null,
            neglectThreshold: 2,
            immediateEscalation: false,
            vagueReplyEscalation: false,
            onlyFollowUpOnShift: false,
            delayIfOffShift: true,
            escalateUrgentOffShift: true,
            fallbackTimingMinutes: 60,
            toneStyle: 'supportive_firm',
            encourageClarity: true,
            pushForNextSteps: true,
            avoidFillerMessages: true,
            primaryEmployeeId: null,
            primaryEmployee: null,
            fallbackSlackGroupId: DEFAULT_GR_GROUP,
            checkShiftSchedule: true
        };
    }

    async getSettingsForTask(event: ZapierTriggerEvent): Promise<AISettings> {
        const defaults = this.getDefaultSettings();

        try {
            const settings = await this.settingsService.resolveSettingsForEvent(event);
            if (settings) {
                if (settings.isActive === false) {
                    return {
                        ...defaults,
                        ...settings,
                        aiEnabled: false,
                        aiMode: (settings.aiMode as 'standard' | 'strict' | 'lenient') || 'standard',
                        useAIForDecisions: false,
                        replyWhenTagged: false,
                        fallbackSlackGroupId: settings.fallbackSlackGroupId || DEFAULT_GR_GROUP,
                    };
                }

                return {
                    ...defaults,
                    ...settings,
                    aiEnabled: settings.aiEnabled ?? true,
                    aiMode: (settings.aiMode as 'standard' | 'strict' | 'lenient') || 'standard',
                    aiInstructions: settings.aiInstructions || null,
                    fallbackSlackGroupId: settings.fallbackSlackGroupId || DEFAULT_GR_GROUP,
                };
            }
        } catch (error) {
            logger.warn('[AIEscalationManager] Error fetching AI settings, using defaults:', error);
        }

        return defaults;
    }

    async analyzeAndDecide(taskId: number): Promise<AIDecision> {
        await this.ensureSchema();

        let context: TaskContext | null = null;
        let aiSettings = this.getDefaultSettings();

        try {
            const event = await this.eventRepo.findOne({ where: { id: taskId } });
            if (!event) {
                return this.createFallbackDecision('SKIP', 'Task not found');
            }

            aiSettings = await this.getSettingsForTask(event);
            if (!aiSettings.aiEnabled || !aiSettings.useAIForDecisions) {
                return {
                    ...this.createFallbackDecision('REMIND', 'FALLBACK_TO_STANDARD'),
                    message: 'FALLBACK_TO_STANDARD'
                };
            }

            context = await this.getTaskContext(taskId, aiSettings);
            if (!context) {
                return this.createFallbackDecision('SKIP', 'Task context unavailable');
            }

            const decision = await this.makeAIDecision(context);
            await this.persistLastReview(context, decision);
            await this.logDecision(taskId, context, decision, aiSettings);
            return decision;
        } catch (error) {
            logger.error(`[AIEscalationManager] Error analyzing task ${taskId}:`, error);
            if (context) {
                await this.persistLastReview(context, this.createFallbackDecision('REMIND', 'AI analysis failed'));
            }
            try {
                await this.logRepo.save({
                    taskId,
                    slackChannel: context?.slackChannel || null,
                    eventType: context?.event?.event || null,
                    decision: 'ERROR',
                    aiMode: aiSettings.aiMode,
                    error: error instanceof Error ? error.message : String(error),
                    executed: false
                });
            } catch (logError) {
                logger.warn('[AIEscalationManager] Failed to log decision error:', logError);
            }
            return this.createFallbackDecision('REMIND', 'AI analysis failed');
        }
    }

    async executeDecision(taskId: number, decision: AIDecision, slackChannel: string, threadTs: string): Promise<boolean> {
        await this.ensureSchema();

        let executed = false;

        try {
            const event = await this.eventRepo.findOne({ where: { id: taskId } });
            if (!event) return false;

            switch (decision.action) {
                case 'SKIP':
                    event.nextFollowUpAt = decision.nextFollowUpAt || null;
                    await this.eventRepo.save(event);
                    executed = true;
                    break;
                case 'REMIND':
                case 'ASK_UPDATE':
                case 'ESCALATE': {
                    const fullMessage = [decision.mention, decision.message].filter(Boolean).join(' ').trim();
                    if (!fullMessage) break;
                    const result = await sendSlackMessage({ channel: slackChannel, text: fullMessage }, threadTs);
                    if (result?.ok) {
                        event.lastReminderAt = new Date();
                        event.reminderCount = (event.reminderCount || 0) + 1;
                        event.ignoredPromptCount = (event.ignoredPromptCount || 0) + 1;
                        event.nextFollowUpAt = decision.nextFollowUpAt || null;
                        await this.eventRepo.save(event);
                        executed = true;
                    }
                    break;
                }
                case 'AUTO_COMPLETE':
                    event.status = 'Completed';
                    event.completedOn = new Date();
                    event.isOverdue = false;
                    event.nextFollowUpAt = null;
                    event.completionQualityScore = decision.evaluation.completionQuality;
                    await this.eventRepo.save(event);
                    executed = true;
                    break;
                case 'AUTO_IN_PROGRESS':
                    event.status = 'In Progress';
                    event.isOverdue = false;
                    event.nextFollowUpAt = decision.nextFollowUpAt || null;
                    await this.eventRepo.save(event);
                    executed = true;
                    break;
            }

            await this.markLogExecuted(taskId, decision.action, executed);
            return executed;
        } catch (error) {
            logger.error(`[AIEscalationManager] Error executing decision for task ${taskId}:`, error);
            await this.markLogExecuted(taskId, decision.action, false, error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    async reviewCompletion(taskId: number): Promise<CompletionReview | null> {
        await this.ensureSchema();

        const event = await this.eventRepo.findOne({ where: { id: taskId } });
        if (!event) return null;

        const aiSettings = await this.getSettingsForTask(event);
        if (!aiSettings.enableCompletionReview) return null;

        const context = await this.getTaskContext(taskId, aiSettings);
        if (!context) return null;

        const latestHuman = context.latestHumanReplies[context.latestHumanReplies.length - 1];
        const latestText = latestHuman?.text?.toLowerCase() || '';
        const hasResolutionKeywords = /(resolved|fixed|completed|done|guest confirmed|issue handled|refund sent|sent update)/.test(latestText);
        const hasDetail = latestText.split(/\s+/).length >= 8;

        let completionQuality = 0.4;
        if (hasResolutionKeywords) completionQuality += 0.35;
        if (hasDetail) completionQuality += 0.25;
        completionQuality = Math.max(0, Math.min(1, completionQuality));

        let message: string | null = null;
        let escalateToManager = false;

        if (completionQuality >= 0.85) {
            if (aiSettings.allowPositiveReinforcement) {
                message = 'Nice close-out. The thread shows clear resolution details, so this looks ready to stay completed.';
            }
        } else if (completionQuality >= 0.55) {
            if (aiSettings.askForMissingDetails) {
                message = 'Before we leave this closed, please add one quick note on the final resolution so the thread is easier to audit later.';
            }
        } else if (aiSettings.requireClearResolution) {
            message = 'This was marked completed, but the thread does not clearly show the final resolution yet. Please add the outcome, guest impact, and next step if anything is still pending.';
            escalateToManager = aiSettings.escalateWeakCompletion;
        }

        if (aiSettings.suppressGenericMessages && !message) {
            return {
                shouldSendMessage: false,
                message: null,
                completionQuality,
                reasoningSummary: 'Completion review found no useful follow-up message.',
                escalateToManager
            };
        }

        return {
            shouldSendMessage: !!message,
            message,
            completionQuality,
            reasoningSummary: `Completion review scored ${completionQuality.toFixed(2)} based on the latest completion evidence in-thread.`,
            escalateToManager
        };
    }

    async handleMention(channel: string, threadTs: string, userMessage: string, userId: string): Promise<string | null> {
        await this.ensureSchema();

        try {
            const slackMsg = await this.slackMessageRepo.findOne({
                where: { channel, messageTs: threadTs, entityType: 'zapier_trigger_event' }
            });

            if (!slackMsg) return null;

            const event = await this.eventRepo.findOne({ where: { id: slackMsg.entityId } });
            if (!event) return null;

            const settings = await this.getSettingsForTask(event);
            if (!settings.replyWhenTagged) {
                return null;
            }

            const context = await this.getTaskContext(event.id, settings);
            if (!context) return null;

            return await this.generateConversationalResponse(context, userMessage, userId);
        } catch (error) {
            logger.error('[AIEscalationManager] Error handling mention:', error);
            return 'I hit an issue reading the task context just now. Please try again in the thread, and if it keeps failing I should be reviewed in the AI logs.';
        }
    }

    private async getTaskContext(taskId: number, aiSettings?: AISettings): Promise<TaskContext | null> {
        const event = await this.eventRepo.findOne({ where: { id: taskId } });
        if (!event) return null;

        const slackMsg = await this.slackMessageRepo.findOne({
            where: { entityType: 'zapier_trigger_event', entityId: taskId }
        });
        if (!slackMsg) return null;

        const settings = aiSettings || await this.getSettingsForTask(event);
        const threadMessages = settings.readSlackReplies
            ? await this.getSlackThreadMessages(slackMsg.channel, slackMsg.messageTs)
            : [];

        const recentLogs = await this.logRepo.find({
            where: { taskId },
            order: { createdAt: 'DESC' },
            take: 10
        });

        const now = Date.now();
        const createdAt = new Date(event.createdAt).getTime();
        const hoursSinceCreation = Math.floor((now - createdAt) / (1000 * 60 * 60));

        const humanMessages = threadMessages.filter(msg => !msg.bot_id);
        const latestHumanReplies = humanMessages.slice(-3);
        const lastActivityTs = humanMessages.length > 0
            ? Math.max(...humanMessages.map(msg => parseFloat(msg.ts) * 1000))
            : createdAt;
        const hoursSinceLastActivity = Math.floor((now - lastActivityTs) / (1000 * 60 * 60));

        const assignedRep = await this.resolveAssignedRep(settings);
        const feedbackRules = await this.getRelevantFeedbackRules(event, slackMsg.channel);

        return {
            event,
            threadMessages,
            latestHumanReplies,
            hoursSinceCreation,
            hoursSinceLastActivity,
            reminderCount: event.reminderCount || 0,
            neglectCount: event.ignoredPromptCount || 0,
            vagueReplyCount: event.vagueReplyCount || 0,
            slackChannel: event.slackChannel || slackMsg.channel || undefined,
            aiSettings: settings,
            feedbackRules,
            recentLogs,
            assignedRepName: assignedRep?.name || event.assignedRepName || null,
            assignedRepSlackId: assignedRep?.slackUserId || event.assignedRepSlackId || null,
            assignedRepOnShift: assignedRep?.onShift ?? null,
            statusHistory: recentLogs
                .slice()
                .reverse()
                .map(log => `${log.createdAt.toISOString()}: ${log.decision}`)
        };
    }

    private async resolveAssignedRep(settings: AISettings): Promise<{ name: string; slackUserId: string | null; onShift: boolean | null } | null> {
        if (!settings.primaryEmployeeId) {
            return settings.primaryEmployee
                ? {
                    name: settings.primaryEmployee.name,
                    slackUserId: settings.primaryEmployee.slackUserId,
                    onShift: null
                }
                : null;
        }

        try {
            const employee = await this.employeeRepo.findOne({
                where: { id: settings.primaryEmployeeId, isActive: true },
                relations: ['user']
            });

            if (!employee) return null;

            const name = employee.user
                ? `${employee.user.firstName || ''} ${employee.user.lastName || ''}`.trim() || `Employee #${employee.id}`
                : `Employee #${employee.id}`;

            return {
                name,
                slackUserId: employee.slackUserId || employee.slackId || null,
                onShift: settings.checkShiftSchedule ? this.isCurrentTimeInSchedule(employee.schedule || '') : null
            };
        } catch (error) {
            logger.warn('[AIEscalationManager] Failed to resolve assigned rep:', error);
            return null;
        }
    }

    private isCurrentTimeInSchedule(schedule: string): boolean {
        if (!schedule) return false;

        try {
            const now = new Date();
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/New_York',
                weekday: 'short',
                hour: 'numeric',
                minute: 'numeric',
                hour12: false
            }).formatToParts(now);

            const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
            const currentDay = parts.find(part => part.type === 'weekday')?.value || 'Sun';
            const currentDayNum = dayMap[currentDay] ?? 0;
            const currentHour = parseInt(parts.find(part => part.type === 'hour')?.value || '0', 10);
            const currentMinute = parseInt(parts.find(part => part.type === 'minute')?.value || '0', 10);
            const currentMinutes = currentHour * 60 + currentMinute;

            const lower = schedule.toLowerCase();
            const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            const matchedDays = lower.match(/(sun|mon|tue|wed|thu|fri|sat)/g) || [];
            if (matchedDays.length > 0 && !matchedDays.some(day => dayNames.indexOf(day) === currentDayNum)) {
                return false;
            }

            const timeMatch = lower.match(/(\d{1,2})(:\d{2})?\s*(am|pm)?\s*-\s*(\d{1,2})(:\d{2})?\s*(am|pm)?/);
            if (!timeMatch) return true;

            let startHour = parseInt(timeMatch[1], 10);
            const startMinute = timeMatch[2] ? parseInt(timeMatch[2].slice(1), 10) : 0;
            let endHour = parseInt(timeMatch[4], 10);
            const endMinute = timeMatch[5] ? parseInt(timeMatch[5].slice(1), 10) : 0;

            if (timeMatch[3] === 'pm' && startHour < 12) startHour += 12;
            if (timeMatch[3] === 'am' && startHour === 12) startHour = 0;
            if (timeMatch[6] === 'pm' && endHour < 12) endHour += 12;
            if (timeMatch[6] === 'am' && endHour === 12) endHour = 0;

            const startMinutes = startHour * 60 + startMinute;
            const endMinutes = endHour * 60 + endMinute;
            return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
        } catch (error) {
            logger.warn('[AIEscalationManager] Failed to parse schedule:', error);
            return false;
        }
    }

    private async getRelevantFeedbackRules(event: ZapierTriggerEvent, slackChannel?: string): Promise<FeedbackRule[]> {
        const logs = await this.logRepo
            .createQueryBuilder('log')
            .where('log.feedbackAt IS NOT NULL')
            .orderBy('log.feedbackAt', 'DESC')
            .limit(50)
            .getMany()
            .catch(() => []);

        const channel = slackChannel || event.slackChannel || '';
        return (logs || [])
            .filter(log => !!log.feedback)
            .filter(log => {
                const scope = log.feedbackScope || 'global';
                if (scope === 'global') return true;
                if (scope === 'task_only') return log.taskId === event.id;
                if (scope === 'channel') return log.slackChannel === channel;
                if (scope === 'event_type') return log.eventType === event.event;
                return false;
            })
            .slice(0, 12)
            .map(log => ({
                id: log.id,
                scope: log.feedbackScope || 'global',
                comment: log.managerComment || log.feedback || '',
                expectedBehavior: log.expectedBehavior || null,
                feedbackType: log.feedbackType || null,
                rating: log.feedbackRating || null
            }));
    }

    private async makeAIDecision(context: TaskContext): Promise<AIDecision> {
        const heuristicEvaluation = this.buildHeuristicEvaluation(context);
        const prompt = this.buildDecisionPrompt(context, heuristicEvaluation);

        try {
            const openai = this.getOpenAI();
            const systemPrompt = this.buildSystemPrompt(context);
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.2,
                max_tokens: 500,
                response_format: { type: 'json_object' }
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                return this.decisionFromHeuristics(context, heuristicEvaluation, 'Empty AI response');
            }

            const parsed = JSON.parse(content);
            return this.normalizeAIDecision(context, parsed, content, heuristicEvaluation);
        } catch (error) {
            logger.warn('[AIEscalationManager] AI decision generation failed, using heuristics:', error);
            return this.decisionFromHeuristics(context, heuristicEvaluation, 'Fallback heuristics used');
        }
    }

    private buildSystemPrompt(context: TaskContext): string {
        const persona = this.MANAGER_PERSONAS[context.aiSettings.aiMode] || this.MANAGER_PERSONAS.standard;
        const settings = context.aiSettings;
        const toggles = [
            `Reply when tagged: ${settings.replyWhenTagged}`,
            `Require actionable responses: ${settings.requireActionableResponses}`,
            `Count acknowledgment as activity: ${settings.countAcknowledgmentAsActivity}`,
            `Urgency overrides timing: ${settings.urgencyOverridesTiming}`,
            `Avoid filler messages: ${settings.avoidFillerMessages}`,
            `Encourage clarity: ${settings.encourageClarity}`,
            `Push for next steps: ${settings.pushForNextSteps}`,
            `Tone style: ${settings.toneStyle}`,
        ].join('\n');

        const feedbackGuidance = context.feedbackRules.length > 0
            ? context.feedbackRules
                .map(rule => `- Scope=${rule.scope}; rating=${rule.rating || 'neutral'}; comment=${rule.comment}; expected=${rule.expectedBehavior || 'n/a'}`)
                .join('\n')
            : 'No manager feedback rules found.';

        return `${persona}

Use the settings and prior manager feedback as operating guidance.

SETTINGS:
${toggles}

MANAGER FEEDBACK GUIDANCE:
${feedbackGuidance}

Return only valid JSON.`;
    }

    private buildDecisionPrompt(context: TaskContext, heuristicEvaluation: AIEvaluation): string {
        const threadSummary = context.threadMessages
            .slice(-25)
            .map(msg => `${msg.bot_id ? '[BOT]' : '[USER]'} ${msg.username || msg.user || 'unknown'}: ${msg.text?.substring(0, 240)}`)
            .join('\n');

        const latestReplies = context.latestHumanReplies
            .map(msg => msg.text?.substring(0, 180))
            .join('\n');

        const recentLogs = context.recentLogs
            .slice(0, 5)
            .map(log => `${log.createdAt.toISOString()} ${log.decision}: ${log.reasoningSummary || log.reason || log.message || ''}`)
            .join('\n');

        return `Evaluate this GR task like a real operations manager.

TASK METADATA
- Event type: ${context.event.event}
- Title: ${context.event.title || 'N/A'}
- Status: ${context.event.status}
- Original message: ${(context.event.message || '').substring(0, 700)}
- Hours since created: ${context.hoursSinceCreation}
- Hours since last human activity: ${context.hoursSinceLastActivity}
- Reminder count: ${context.reminderCount}
- Ignored prompt count: ${context.neglectCount}
- Vague reply count: ${context.vagueReplyCount}
- Assigned rep: ${context.assignedRepName || 'None'}
- Assigned rep on shift: ${context.assignedRepOnShift === null ? 'unknown' : context.assignedRepOnShift ? 'yes' : 'no'}

LATEST REP REPLIES
${latestReplies || 'No recent human replies'}

THREAD
${threadSummary || 'No thread activity'}

STATUS/AI HISTORY
${recentLogs || 'No recent AI history'}

HEURISTIC BASELINE
${JSON.stringify(heuristicEvaluation)}

Return JSON with:
{
  "severity_level": "low|medium|high|critical",
  "rep_engagement_type": "none|acknowledgment|vague|actionable|complete",
  "neglect_count": number,
  "urgency_score": number,
  "completion_quality": number,
  "recommended_action": "SKIP|REMIND|ASK_UPDATE|ESCALATE|AUTO_COMPLETE|AUTO_IN_PROGRESS",
  "next_follow_up_time": "ISO timestamp or null",
  "escalation_required": boolean,
  "reasoning_summary": "short summary",
  "message": "optional useful manager message only",
  "should_mention": boolean,
  "ask_manager_tag": "serious|neglect|bad_completion|none"
}

Rules:
- Strong actionable update should usually delay follow-up.
- No response or repeated neglect should shorten follow-up.
- Vague reply should trigger ASK_UPDATE unless severity or neglect requires ESCALATE.
- Only use AUTO_COMPLETE if the thread clearly shows resolution.
- Do not produce thank-you filler.
- Keep any message to 1-3 sentences and make it operationally useful.`;
    }

    private normalizeAIDecision(
        context: TaskContext,
        parsed: any,
        rawResponse: string,
        heuristicEvaluation: AIEvaluation
    ): AIDecision {
        const evaluation: AIEvaluation = {
            severityLevel: this.normalizeEnum(parsed.severity_level, ['low', 'medium', 'high', 'critical'], heuristicEvaluation.severityLevel),
            repEngagementType: this.normalizeEnum(parsed.rep_engagement_type, ['none', 'acknowledgment', 'vague', 'actionable', 'complete'], heuristicEvaluation.repEngagementType),
            neglectCount: Number.isFinite(parsed.neglect_count) ? Number(parsed.neglect_count) : heuristicEvaluation.neglectCount,
            urgencyScore: this.normalizeScore(parsed.urgency_score, heuristicEvaluation.urgencyScore),
            completionQuality: this.normalizeScore(parsed.completion_quality, heuristicEvaluation.completionQuality),
            recommendedAction: this.normalizeEnum(parsed.recommended_action, ['SKIP', 'REMIND', 'ASK_UPDATE', 'ESCALATE', 'AUTO_COMPLETE', 'AUTO_IN_PROGRESS'], heuristicEvaluation.recommendedAction) as DecisionAction,
            nextFollowUpTime: this.normalizeNextFollowUp(context.aiSettings, parsed.next_follow_up_time),
            escalationRequired: typeof parsed.escalation_required === 'boolean' ? parsed.escalation_required : heuristicEvaluation.escalationRequired,
            reasoningSummary: typeof parsed.reasoning_summary === 'string' && parsed.reasoning_summary.trim()
                ? parsed.reasoning_summary.trim()
                : heuristicEvaluation.reasoningSummary
        };

        const managerMention = this.getManagerMention(context.aiSettings, parsed.ask_manager_tag, evaluation);
        const mention = parsed.should_mention ? managerMention || this.getDefaultMention(context.aiSettings) : managerMention;
        const action = evaluation.recommendedAction;

        return {
            action,
            reason: evaluation.reasoningSummary,
            message: this.cleanOperationalMessage(parsed.message),
            mention,
            nextFollowUpAt: evaluation.nextFollowUpTime ? new Date(evaluation.nextFollowUpTime) : null,
            evaluation,
            rawResponse
        };
    }

    private decisionFromHeuristics(context: TaskContext, evaluation: AIEvaluation, reason: string): AIDecision {
        const action = evaluation.recommendedAction;
        const mention = action === 'ESCALATE'
            ? this.getManagerMention(context.aiSettings, 'neglect', evaluation) || this.getDefaultMention(context.aiSettings)
            : undefined;

        let message: string | undefined;
        if (action === 'ASK_UPDATE') {
            message = 'Please post the current status, blocker, and next step for this task so we can keep it moving.';
        } else if (action === 'REMIND') {
            message = 'This task still needs active follow-through. Please update the thread with the current owner and next step.';
        } else if (action === 'ESCALATE') {
            message = 'This task is showing signs of neglect or elevated guest risk and needs manager visibility now.';
        }

        return {
            action,
            reason,
            message,
            mention,
            nextFollowUpAt: evaluation.nextFollowUpTime ? new Date(evaluation.nextFollowUpTime) : null,
            evaluation
        };
    }

    private buildHeuristicEvaluation(context: TaskContext): AIEvaluation {
        const latestText = (context.latestHumanReplies[context.latestHumanReplies.length - 1]?.text || '').toLowerCase();
        const severityLevel = this.inferSeverity(context);
        const repEngagementType = this.inferRepEngagement(context, latestText);
        const urgencyBase = severityLevel === 'critical' ? 0.95 : severityLevel === 'high' ? 0.8 : severityLevel === 'medium' ? 0.55 : 0.3;
        const inactivityPenalty = Math.min(0.35, context.hoursSinceLastActivity / 24);
        const urgencyScore = Math.min(1, urgencyBase + inactivityPenalty + (context.neglectCount * 0.1));
        const completionQuality = repEngagementType === 'complete' ? 0.9 : repEngagementType === 'actionable' ? 0.65 : repEngagementType === 'acknowledgment' ? 0.35 : 0.15;

        let recommendedAction: DecisionAction = 'SKIP';
        if (repEngagementType === 'complete' && context.event.status !== 'Completed') {
            recommendedAction = 'AUTO_COMPLETE';
        } else if (repEngagementType === 'actionable' && context.event.status === 'New') {
            recommendedAction = 'AUTO_IN_PROGRESS';
        } else if (repEngagementType === 'vague') {
            recommendedAction = context.aiSettings.vagueReplyEscalation && context.vagueReplyCount >= 1 ? 'ESCALATE' : 'ASK_UPDATE';
        } else if (repEngagementType === 'none' || context.hoursSinceLastActivity >= 4) {
            recommendedAction = urgencyScore >= 0.85 || context.neglectCount >= context.aiSettings.neglectThreshold ? 'ESCALATE' : 'REMIND';
        }

        const nextFollowUpTime = this.computeNextFollowUp(context, recommendedAction, repEngagementType, urgencyScore);

        return {
            severityLevel,
            repEngagementType,
            neglectCount: context.neglectCount,
            urgencyScore,
            completionQuality,
            recommendedAction,
            nextFollowUpTime,
            escalationRequired: recommendedAction === 'ESCALATE' || context.aiSettings.immediateEscalation,
            reasoningSummary: `Heuristic baseline: severity=${severityLevel}, engagement=${repEngagementType}, urgency=${urgencyScore.toFixed(2)}`
        };
    }

    private inferSeverity(context: TaskContext): 'low' | 'medium' | 'high' | 'critical' {
        const content = `${context.event.event} ${context.event.title || ''} ${context.event.message || ''}`.toLowerCase();
        if (/(safety|refund|police|threat|urgent access|lockout|severe|injury|fire)/.test(content)) return 'critical';
        if (/(vip|complaint|bad review|escalation|manager|damaged|angry guest)/.test(content)) return 'high';
        if (/(late|delay|issue|problem|follow up|maintenance)/.test(content)) return 'medium';
        return 'low';
    }

    private inferRepEngagement(context: TaskContext, latestText: string): 'none' | 'acknowledgment' | 'vague' | 'actionable' | 'complete' {
        if (!latestText) return 'none';
        if (/(resolved|fixed|completed|done|handled|guest confirmed|issue closed)/.test(latestText)) return 'complete';
        if (/(called|emailed|sent|booked|scheduled|arranged|waiting on|eta|will update by|next step)/.test(latestText)) return 'actionable';
        if (/(looking into it|working on it|on it|checking now|will see)/.test(latestText)) return 'vague';
        if (/(got it|ack|okay|ok|noted|thanks)/.test(latestText)) {
            return context.aiSettings.countAcknowledgmentAsActivity ? 'acknowledgment' : 'none';
        }
        return latestText.split(/\s+/).length >= 8 ? 'actionable' : 'vague';
    }

    private computeNextFollowUp(
        context: TaskContext,
        action: DecisionAction,
        engagement: AIEvaluation['repEngagementType'],
        urgencyScore: number
    ): string | null {
        const settings = context.aiSettings;
        const now = Date.now();
        const minMs = settings.minFollowUpMinutes * 60 * 1000;
        const maxMs = settings.maxFollowUpMinutes * 60 * 1000;

        let ms = settings.fallbackTimingMinutes * 60 * 1000;

        if (action === 'SKIP') {
            ms = Math.min(maxMs, Math.max(minMs, 3 * 60 * 60 * 1000));
        } else if (engagement === 'actionable') {
            ms = Math.min(maxMs, Math.max(minMs, 4 * 60 * 60 * 1000));
        } else if (engagement === 'acknowledgment') {
            ms = Math.min(maxMs, Math.max(minMs, 2 * 60 * 60 * 1000));
        } else if (engagement === 'vague') {
            ms = Math.max(minMs, 60 * 60 * 1000);
        } else if (action === 'ESCALATE' || urgencyScore >= 0.85) {
            ms = minMs;
        }

        if (settings.urgencyOverridesTiming && urgencyScore >= 0.95) {
            ms = Math.min(ms, 15 * 60 * 1000);
        }

        if (settings.onlyFollowUpOnShift && context.assignedRepOnShift === false && settings.delayIfOffShift) {
            ms = Math.max(ms, settings.fallbackTimingMinutes * 60 * 1000);
        }

        return new Date(now + Math.max(minMs, Math.min(maxMs, ms))).toISOString();
    }

    private cleanOperationalMessage(message: unknown): string | undefined {
        if (typeof message !== 'string') return undefined;
        const trimmed = message.trim();
        if (!trimmed || /thanks team! marked completed/i.test(trimmed)) return undefined;
        return trimmed;
    }

    private normalizeScore(value: unknown, fallback: number): number {
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        return Math.max(0, Math.min(1, num));
    }

    private normalizeEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
        return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
    }

    private normalizeNextFollowUp(settings: AISettings, nextFollowUpTime: unknown): string | null {
        if (!settings.allowAIAdjustTiming) return null;
        if (!nextFollowUpTime || typeof nextFollowUpTime !== 'string') return null;
        const date = new Date(nextFollowUpTime);
        if (Number.isNaN(date.getTime())) return null;

        const now = Date.now();
        const minMs = settings.minFollowUpMinutes * 60 * 1000;
        const maxMs = settings.maxFollowUpMinutes * 60 * 1000;
        const delta = Math.max(minMs, Math.min(maxMs, date.getTime() - now));
        return new Date(now + delta).toISOString();
    }

    private getDefaultMention(settings: AISettings): string {
        return `<!subteam^${settings.fallbackSlackGroupId || DEFAULT_GR_GROUP}>`;
    }

    private getManagerMention(settings: AISettings, askManagerTag: unknown, evaluation: AIEvaluation): string | undefined {
        const requested = typeof askManagerTag === 'string' ? askManagerTag : 'none';
        const tag = requested === 'serious'
            ? settings.managerTagSerious
            : requested === 'bad_completion'
                ? settings.managerTagBadCompletion
                : requested === 'neglect'
                    ? settings.managerTagNeglect
                    : evaluation.escalationRequired
                        ? settings.managerTagNeglect || settings.managerTagSerious
                        : null;

        return tag ? `<@${tag}>` : undefined;
    }

    private createFallbackDecision(action: DecisionAction, reason: string): AIDecision {
        return {
            action,
            reason,
            evaluation: {
                severityLevel: 'medium',
                repEngagementType: 'none',
                neglectCount: 0,
                urgencyScore: 0.5,
                completionQuality: 0.2,
                recommendedAction: action,
                nextFollowUpTime: null,
                escalationRequired: action === 'ESCALATE',
                reasoningSummary: reason
            }
        };
    }

    private async persistLastReview(context: TaskContext, decision: AIDecision): Promise<void> {
        try {
            const event = context.event;
            event.nextFollowUpAt = decision.nextFollowUpAt || null;
            event.lastAiReviewSummary = decision.evaluation.reasoningSummary;
            event.lastAiReviewPayload = JSON.stringify({
                action: decision.action,
                reason: decision.reason,
                message: decision.message,
                evaluation: decision.evaluation,
                rawResponse: decision.rawResponse || null
            });
            event.lastAiReviewAt = new Date();
            event.completionQualityScore = decision.evaluation.completionQuality;
            event.assignedRepName = context.assignedRepName || null;
            event.assignedRepSlackId = context.assignedRepSlackId || null;
            await this.eventRepo.save(event);
        } catch (error) {
            logger.warn('[AIEscalationManager] Failed to persist last AI review:', error);
        }
    }

    private async logDecision(
        taskId: number,
        context: TaskContext,
        decision: AIDecision,
        aiSettings: AISettings
    ): Promise<void> {
        try {
            const contextSummary = context.threadMessages
                .slice(-8)
                .map(msg => `${msg.bot_id ? '[BOT]' : '[USER]'} ${msg.username || msg.user || 'unknown'}: ${msg.text?.substring(0, 140)}`)
                .join('\n');

            const log = this.logRepo.create({
                taskId,
                slackChannel: context.slackChannel || null,
                eventType: context.event.event || null,
                decision: decision.action,
                aiMode: aiSettings.aiMode,
                message: decision.message || null,
                reason: decision.reason || null,
                severityLevel: decision.evaluation.severityLevel,
                repEngagementType: decision.evaluation.repEngagementType,
                neglectCount: decision.evaluation.neglectCount,
                urgencyScore: decision.evaluation.urgencyScore,
                completionQuality: decision.evaluation.completionQuality,
                recommendedAction: decision.evaluation.recommendedAction,
                nextFollowUpAt: decision.nextFollowUpAt || null,
                escalationRequired: decision.evaluation.escalationRequired,
                reasoningSummary: decision.evaluation.reasoningSummary,
                decisionInputSummary: [
                    `status=${context.event.status}`,
                    `hoursSinceLastActivity=${context.hoursSinceLastActivity}`,
                    `assignedRep=${context.assignedRepName || 'none'}`,
                    `assignedRepOnShift=${context.assignedRepOnShift === null ? 'unknown' : context.assignedRepOnShift}`,
                    `feedbackRules=${context.feedbackRules.length}`
                ].join('; '),
                decisionPayload: JSON.stringify({
                    evaluation: decision.evaluation,
                    message: decision.message || null,
                    mention: decision.mention || null,
                    rawResponse: decision.rawResponse || null
                }),
                executed: false,
                hoursSinceCreation: context.hoursSinceCreation,
                hoursSinceLastActivity: context.hoursSinceLastActivity,
                previousReminderCount: context.reminderCount,
                customInstructions: aiSettings.aiInstructions,
                contextSummary
            });

            await this.logRepo.save(log);
        } catch (error) {
            logger.warn('[AIEscalationManager] Failed to log decision:', error);
        }
    }

    private async markLogExecuted(taskId: number, action: string, executed: boolean, error?: string): Promise<void> {
        try {
            const log = await this.logRepo.findOne({
                where: { taskId, decision: action },
                order: { createdAt: 'DESC' }
            });

            if (!log) return;

            log.executed = executed;
            if (error) log.error = error;
            await this.logRepo.save(log);
        } catch (err) {
            logger.warn('[AIEscalationManager] Failed to update log execution status:', err);
        }
    }

    private async generateConversationalResponse(context: TaskContext, userMessage: string, userId: string): Promise<string> {
        const summary = context.threadMessages
            .slice(-15)
            .map(msg => `${msg.bot_id ? '[BOT]' : '[USER]'} ${msg.username || msg.user || 'unknown'}: ${msg.text?.substring(0, 180)}`)
            .join('\n');

        try {
            const openai = this.getOpenAI();
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `${this.MANAGER_PERSONAS.standard}

You are replying because a user directly tagged you in a GR task thread. Read the thread context and respond naturally.
Be concise, contextual, and useful. If they are vague, ask for specifics. If they give a strong update, acknowledge it and set expectations.`
                    },
                    {
                        role: 'user',
                        content: `TASK STATUS: ${context.event.status}
EVENT TYPE: ${context.event.event}
ASSIGNED REP: ${context.assignedRepName || 'Unknown'}
RECENT THREAD:
${summary || 'No thread activity'}

USER (${userId}) SAID:
${userMessage}`
                    }
                ],
                temperature: 0.4,
                max_tokens: 220
            });

            return response.choices[0]?.message?.content?.trim()
                || "I read the thread, but I need a clearer update. Please post the current status, blocker, and next step.";
        } catch (error) {
            logger.warn('[AIEscalationManager] Conversational reply generation failed:', error);
            return "I read the thread. Please post the current status, blocker, and next step so I can react more precisely.";
        }
    }

    private async getSlackThreadMessages(channelId: string, threadTs: string): Promise<ThreadMessage[]> {
        try {
            const response = await axios.get('https://slack.com/api/conversations.replies', {
                headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
                params: { channel: channelId, ts: threadTs, limit: 100 }
            });

            if (!response.data.ok) {
                logger.error(`[AIEscalationManager] Slack API error: ${response.data.error}`);
                return [];
            }

            return response.data.messages?.slice(1) || [];
        } catch (error) {
            logger.error('[AIEscalationManager] Error fetching thread messages:', error);
            return [];
        }
    }
}
