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

interface AISettings {
    aiEnabled: boolean;
    aiMode: 'standard' | 'strict' | 'lenient';
    aiInstructions: string | null;
}

// AI Decision types
export type AIDecision = 
    | { action: 'SKIP'; reason: string }
    | { action: 'REMIND'; message: string; mention?: string }
    | { action: 'ASK_UPDATE'; message: string; mention?: string }
    | { action: 'ESCALATE'; message: string; escalateTo?: string }
    | { action: 'AUTO_COMPLETE'; reason: string }
    | { action: 'AUTO_IN_PROGRESS'; reason: string };

interface ThreadMessage {
    ts: string;
    user?: string;
    text: string;
    bot_id?: string;
    username?: string;
}

interface TaskContext {
    event: ZapierTriggerEvent;
    threadMessages: ThreadMessage[];
    hoursSinceCreation: number;
    hoursSinceLastActivity: number;
    reminderCount: number;
    assignedTo?: string;
    slackChannel?: string;
    aiSettings?: AISettings;
}

/**
 * AI-powered Escalation Manager
 * 
 * Acts as an intelligent manager that:
 * - Analyzes task context before sending reminders
 * - Decides appropriate action (skip, remind, ask, escalate, auto-complete)
 * - Generates contextually appropriate messages
 * - Responds to @mentions conversationally
 */
export class AIEscalationManagerService {
    private openai: OpenAI | null = null;
    private eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private employeeRepo = appDatabase.getRepository(Employee);
    private logRepo = appDatabase.getRepository(AIEscalationLog);
    private settingsService = new EscalationSettingsService();

    // Manager persona system prompts by mode
    private readonly MANAGER_PERSONAS: Record<string, string> = {
        standard: `You are an AI Manager for a vacation rental property management company's Guest Relations team.

Your role is to:
1. Monitor task progress and ensure timely completion
2. Send appropriate reminders when tasks are delayed
3. Hold team members accountable while being fair
4. Recognize when tasks are already being handled
5. Escalate critical issues when necessary

Personality:
- Professional but approachable
- Direct and clear in communication
- Critical when excuses are weak, understanding when reasons are valid
- Focused on guest satisfaction and team efficiency
- You use emojis sparingly to keep messages professional

Guidelines:
- If someone has clearly responded and is working on it, don't send unnecessary reminders
- If a task has been sitting with no updates for days, ask for a specific reason
- If the excuse is weak (e.g., "been busy"), push back professionally
- If the reason is valid (e.g., "waiting on guest response"), acknowledge and set expectations
- If something is urgent and being ignored, escalate
- If the thread shows the issue was resolved, recommend auto-completing

Always be concise. Max 2-3 sentences for reminders.`,

        strict: `You are a strict AI Manager for a vacation rental property management company's Guest Relations team.

Your role is to:
1. Ensure tasks are completed QUICKLY - guest satisfaction is paramount
2. Push back firmly on delays and excuses
3. Escalate issues faster than normal
4. Hold team members to high accountability standards

Personality:
- Direct and no-nonsense
- Firm but fair
- Does not accept vague excuses
- Expects immediate action on urgent items

Guidelines:
- Be more aggressive with reminders - shorter grace periods
- Push back on ANY excuse that seems weak
- Escalate after 2 hours of no response on urgent items
- Ask for specific timelines, not vague commitments
- If task sits for 1+ days with no good reason, escalate

Always be concise. Max 2 sentences. Be direct.`,

        lenient: `You are a supportive AI Manager for a vacation rental property management company's Guest Relations team.

Your role is to:
1. Help the team succeed without adding stress
2. Give reasonable time for complex issues
3. Trust team members to handle their work
4. Only escalate truly critical situations

Personality:
- Supportive and understanding
- Patient with reasonable delays
- Trusts team judgment
- Encouraging rather than critical

Guidelines:
- Be more understanding of delays - give longer grace periods
- Accept reasonable explanations without pushing back
- Only send reminders when really necessary
- Skip reminders if there's been any activity in the last few hours
- Trust that "working on it" means they're working on it

Be friendly and supportive. Max 2-3 sentences.`
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

    /**
     * Check if AI is enabled for a given task based on its channel/event settings
     */
    async isAIEnabledForTask(event: ZapierTriggerEvent): Promise<AISettings> {
        try {
            // Try to find settings for this specific channel + event combo
            const channelKey = event.slackChannel?.toLowerCase().replace(/^#/, '') || '';
            const eventKey = event.event || '';
            
            // Try specific key first, then channel-only, then event-only, then default
            const keysToTry = [
                `${channelKey}-${eventKey}`.replace(/\s+/g, '-'),
                channelKey,
                eventKey,
                'default'
            ].filter(k => k);

            for (const key of keysToTry) {
                const settings = await this.settingsService.getSettingsByKey(key);
                if (settings && settings.settingKey !== 'default') {
                    return {
                        aiEnabled: settings.aiEnabled ?? true,
                        aiMode: (settings.aiMode as 'standard' | 'strict' | 'lenient') || 'standard',
                        aiInstructions: settings.aiInstructions || null
                    };
                }
            }

            // Fall back to default settings
            const defaultSettings = await this.settingsService.getSettingsByKey('default');
            return {
                aiEnabled: defaultSettings?.aiEnabled ?? true,
                aiMode: (defaultSettings?.aiMode as 'standard' | 'strict' | 'lenient') || 'standard',
                aiInstructions: defaultSettings?.aiInstructions || null
            };
        } catch (error) {
            logger.warn('[AIEscalationManager] Error fetching AI settings, using defaults:', error);
            return { aiEnabled: true, aiMode: 'standard', aiInstructions: null };
        }
    }

    /**
     * Analyze a task and decide what action to take
     */
    async analyzeAndDecide(taskId: number): Promise<AIDecision> {
        let context: TaskContext | null = null;
        let aiSettings: AISettings = { aiEnabled: true, aiMode: 'standard', aiInstructions: null };
        
        try {
            // Fetch task first to check AI settings
            const event = await this.eventRepo.findOne({ where: { id: taskId } });
            if (!event) {
                return { action: 'SKIP', reason: 'Task not found' };
            }

            // Check if AI is enabled for this task
            aiSettings = await this.isAIEnabledForTask(event);
            if (!aiSettings.aiEnabled) {
                logger.info(`[AIEscalationManager] AI disabled for task ${taskId}, skipping AI analysis`);
                return { action: 'REMIND', message: 'FALLBACK_TO_STANDARD' }; // Signal to use standard reminder
            }

            // Fetch full context
            context = await this.getTaskContext(taskId);
            if (!context) {
                return { action: 'SKIP', reason: 'Task not found or no Slack message' };
            }

            // Add AI settings to context
            context.aiSettings = aiSettings;

            // Use AI to analyze and decide
            const decision = await this.makeAIDecision(context);
            
            logger.info(`[AIEscalationManager] Task ${taskId} decision (mode: ${aiSettings.aiMode}): ${decision.action} - ${
                'reason' in decision ? decision.reason : 'message' in decision ? decision.message.substring(0, 50) : ''
            }`);

            // Log the decision
            await this.logDecision(taskId, context, decision, aiSettings);

            return decision;
        } catch (error) {
            logger.error(`[AIEscalationManager] Error analyzing task ${taskId}:`, error);
            
            // Log the error
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
                logger.warn('[AIEscalationManager] Failed to log error:', logError);
            }
            
            // Fall back to simple reminder on error
            return { 
                action: 'REMIND', 
                message: 'This task needs attention. Please provide an update.' 
            };
        }
    }

    /**
     * Log an AI decision for review
     */
    private async logDecision(
        taskId: number, 
        context: TaskContext, 
        decision: AIDecision, 
        aiSettings: AISettings
    ): Promise<void> {
        try {
            // Create context summary from thread messages
            const contextSummary = context.threadMessages
                .slice(-5)
                .map(m => `${m.bot_id ? '[BOT]' : '[USER]'}: ${m.text?.substring(0, 100)}`)
                .join('\n');

            const log = this.logRepo.create({
                taskId,
                slackChannel: context.slackChannel || null,
                eventType: context.event.event || null,
                decision: decision.action,
                aiMode: aiSettings.aiMode,
                message: 'message' in decision ? decision.message : null,
                reason: 'reason' in decision ? decision.reason : null,
                executed: false, // Will be updated when executed
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

    /**
     * Execute the AI decision - send message, update status, etc.
     */
    async executeDecision(taskId: number, decision: AIDecision, slackChannel: string, threadTs: string): Promise<boolean> {
        let executed = false;
        
        try {
            const event = await this.eventRepo.findOne({ where: { id: taskId } });
            if (!event) return false;

            switch (decision.action) {
                case 'SKIP':
                    logger.info(`[AIEscalationManager] Skipping reminder for task ${taskId}: ${decision.reason}`);
                    executed = true;
                    break;

                case 'REMIND':
                case 'ASK_UPDATE':
                case 'ESCALATE':
                    const mention = decision.mention || '';
                    const fullMessage = mention ? `${mention} ${decision.message}` : decision.message;
                    
                    const result = await sendSlackMessage({ channel: slackChannel, text: fullMessage }, threadTs);
                    
                    if (result?.ok) {
                        // Update reminder tracking
                        event.lastReminderAt = new Date();
                        event.reminderCount = (event.reminderCount || 0) + 1;
                        await this.eventRepo.save(event);
                        executed = true;
                    }
                    break;

                case 'AUTO_COMPLETE':
                    event.status = 'Completed';
                    event.completedOn = new Date();
                    await this.eventRepo.save(event);
                    
                    // Notify in thread
                    await sendSlackMessage({ 
                        channel: slackChannel, 
                        text: `✅ This task has been automatically marked as *Completed* based on the thread activity. (${decision.reason})` 
                    }, threadTs);
                    executed = true;
                    break;

                case 'AUTO_IN_PROGRESS':
                    event.status = 'In Progress';
                    await this.eventRepo.save(event);
                    
                    // Notify in thread
                    await sendSlackMessage({ 
                        channel: slackChannel, 
                        text: `📝 This task has been automatically moved to *In Progress*. (${decision.reason})` 
                    }, threadTs);
                    executed = true;
                    break;
            }

            // Mark the log as executed
            await this.markLogExecuted(taskId, decision.action, executed);
            
            return executed;
        } catch (error) {
            logger.error(`[AIEscalationManager] Error executing decision for task ${taskId}:`, error);
            
            // Log the execution error
            await this.markLogExecuted(taskId, decision.action, false, error instanceof Error ? error.message : String(error));
            
            return false;
        }
    }

    /**
     * Mark the most recent log entry for a task as executed
     */
    private async markLogExecuted(taskId: number, action: string, executed: boolean, error?: string): Promise<void> {
        try {
            // Find the most recent log for this task and action
            const log = await this.logRepo.findOne({
                where: { taskId, decision: action },
                order: { createdAt: 'DESC' }
            });

            if (log) {
                log.executed = executed;
                if (error) log.error = error;
                await this.logRepo.save(log);
            }
        } catch (err) {
            logger.warn('[AIEscalationManager] Failed to update log execution status:', err);
        }
    }

    /**
     * Handle when the bot is @mentioned in a thread
     */
    async handleMention(channel: string, threadTs: string, userMessage: string, userId: string): Promise<string | null> {
        try {
            // Find the task associated with this thread
            const slackMsg = await this.slackMessageRepo.findOne({
                where: { channel, messageTs: threadTs, entityType: 'zapier_trigger_event' }
            });

            if (!slackMsg) {
                // Not a GR task thread, ignore
                return null;
            }

            const event = await this.eventRepo.findOne({ where: { id: slackMsg.entityId } });
            if (!event) return null;

            // Get full context
            const context = await this.getTaskContext(event.id);
            if (!context) return null;

            // Generate AI response
            const response = await this.generateConversationalResponse(context, userMessage, userId);
            
            return response;
        } catch (error) {
            logger.error(`[AIEscalationManager] Error handling mention:`, error);
            return "I encountered an error processing your message. Please try again.";
        }
    }

    /**
     * Get full context for a task
     */
    private async getTaskContext(taskId: number): Promise<TaskContext | null> {
        const event = await this.eventRepo.findOne({ where: { id: taskId } });
        if (!event) return null;

        const slackMsg = await this.slackMessageRepo.findOne({
            where: { entityType: 'zapier_trigger_event', entityId: taskId }
        });
        if (!slackMsg) return null;

        // Fetch thread messages
        const threadMessages = await this.getSlackThreadMessages(slackMsg.channel, slackMsg.messageTs);

        // Calculate time metrics
        const now = Date.now();
        const createdAt = new Date(event.createdAt).getTime();
        const hoursSinceCreation = Math.floor((now - createdAt) / (1000 * 60 * 60));

        // Find last human activity (non-bot message)
        let lastActivityTime = createdAt;
        for (const msg of threadMessages) {
            if (!msg.bot_id) {
                const msgTime = parseFloat(msg.ts) * 1000;
                if (msgTime > lastActivityTime) {
                    lastActivityTime = msgTime;
                }
            }
        }
        const hoursSinceLastActivity = Math.floor((now - lastActivityTime) / (1000 * 60 * 60));

        return {
            event,
            threadMessages,
            hoursSinceCreation,
            hoursSinceLastActivity,
            reminderCount: event.reminderCount || 0,
            slackChannel: event.slackChannel || undefined,
        };
    }

    /**
     * Use AI to make a decision about what action to take
     */
    private async makeAIDecision(context: TaskContext): Promise<AIDecision> {
        const openai = this.getOpenAI();

        // Get the appropriate persona based on AI mode
        const aiMode = context.aiSettings?.aiMode || 'standard';
        const persona = this.MANAGER_PERSONAS[aiMode] || this.MANAGER_PERSONAS.standard;
        
        // Add custom instructions if provided
        let systemPrompt = persona;
        if (context.aiSettings?.aiInstructions) {
            systemPrompt += `\n\nADDITIONAL INSTRUCTIONS FROM MANAGEMENT:\n${context.aiSettings.aiInstructions}`;
        }

        // Build context summary for AI
        const threadSummary = context.threadMessages
            .slice(-15) // Last 15 messages
            .map(msg => {
                const isBot = !!msg.bot_id;
                const sender = isBot ? '[BOT]' : `[USER ${msg.user || 'unknown'}]`;
                return `${sender}: ${msg.text?.substring(0, 200)}`;
            })
            .join('\n');

        const prompt = `Analyze this Guest Relations task and decide the appropriate action.

TASK INFO:
- Event Type: ${context.event.event}
- Title: ${context.event.title || 'N/A'}
- Original Message: ${context.event.message?.substring(0, 500)}
- Status: ${context.event.status}
- Hours since created: ${context.hoursSinceCreation}
- Hours since last human activity: ${context.hoursSinceLastActivity}
- Previous reminders sent: ${context.reminderCount}

THREAD ACTIVITY (last messages):
${threadSummary || 'No thread activity yet'}

Based on this context, decide what action to take. Respond with a JSON object:

{
  "action": "SKIP" | "REMIND" | "ASK_UPDATE" | "ESCALATE" | "AUTO_COMPLETE" | "AUTO_IN_PROGRESS",
  "reason": "brief explanation (for SKIP, AUTO_COMPLETE, AUTO_IN_PROGRESS)",
  "message": "the message to send (for REMIND, ASK_UPDATE, ESCALATE)",
  "shouldMention": true | false,
  "urgencyLevel": "low" | "medium" | "high" | "critical"
}

Decision guidelines:
- SKIP: If someone is actively working on it or recently responded
- REMIND: Simple reminder if task needs attention
- ASK_UPDATE: If task has been sitting 2+ days with no updates, ask why
- ESCALATE: If critical and being ignored for 4+ hours
- AUTO_COMPLETE: If thread clearly shows issue was resolved
- AUTO_IN_PROGRESS: If someone has claimed it but status is still "New"

Be concise in messages. Max 2-3 sentences.`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 300,
            response_format: { type: 'json_object' }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            return { action: 'REMIND', message: 'This task needs attention. Please provide an update.' };
        }

        try {
            const parsed = JSON.parse(content);
            
            // Map AI response to our decision type
            switch (parsed.action) {
                case 'SKIP':
                    return { action: 'SKIP', reason: parsed.reason || 'AI decided to skip' };
                
                case 'AUTO_COMPLETE':
                    return { action: 'AUTO_COMPLETE', reason: parsed.reason || 'Issue resolved' };
                
                case 'AUTO_IN_PROGRESS':
                    return { action: 'AUTO_IN_PROGRESS', reason: parsed.reason || 'Being worked on' };
                
                case 'ESCALATE':
                    return { 
                        action: 'ESCALATE', 
                        message: parsed.message || 'This task requires immediate attention.',
                    };
                
                case 'ASK_UPDATE':
                    return { 
                        action: 'ASK_UPDATE', 
                        message: parsed.message || 'Can you provide an update on this task?',
                        mention: parsed.shouldMention ? '<!subteam^S09AUHMA6HE>' : undefined
                    };
                
                case 'REMIND':
                default:
                    return { 
                        action: 'REMIND', 
                        message: parsed.message || 'This task needs attention. Please provide an update.',
                        mention: parsed.shouldMention ? '<!subteam^S09AUHMA6HE>' : undefined
                    };
            }
        } catch (parseError) {
            logger.warn(`[AIEscalationManager] Failed to parse AI response: ${content}`);
            return { action: 'REMIND', message: 'This task needs attention. Please provide an update.' };
        }
    }

    /**
     * Generate a conversational response when bot is @mentioned
     */
    private async generateConversationalResponse(context: TaskContext, userMessage: string, userId: string): Promise<string> {
        const openai = this.getOpenAI();

        const threadSummary = context.threadMessages
            .slice(-10)
            .map(msg => {
                const isBot = !!msg.bot_id;
                const sender = isBot ? '[BOT]' : `[USER]`;
                return `${sender}: ${msg.text?.substring(0, 200)}`;
            })
            .join('\n');

        const prompt = `You are being @mentioned in a Guest Relations task thread. Respond appropriately.

TASK INFO:
- Event Type: ${context.event.event}
- Title: ${context.event.title || 'N/A'}
- Status: ${context.event.status}
- Hours open: ${context.hoursSinceCreation}
- Hours since last activity: ${context.hoursSinceLastActivity}

RECENT THREAD:
${threadSummary}

USER'S MESSAGE TO YOU:
"${userMessage}"

Respond as a helpful but accountable manager. Be concise (1-3 sentences).
If they're asking for an extension or explaining a delay, evaluate if the reason is valid.
If they're updating on progress, acknowledge it.
If they're asking a question, answer it based on context.
If they're making excuses, push back professionally.

Your response (plain text, no JSON):`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: this.MANAGER_PERSONA },
                { role: 'user', content: prompt }
            ],
            temperature: 0.5,
            max_tokens: 200,
        });

        return response.choices[0]?.message?.content || "I've noted your message. Please continue working on this task.";
    }

    /**
     * Get thread messages from Slack
     */
    private async getSlackThreadMessages(channelId: string, threadTs: string): Promise<ThreadMessage[]> {
        try {
            const response = await axios.get('https://slack.com/api/conversations.replies', {
                headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
                params: { channel: channelId, ts: threadTs, limit: 50 }
            });

            if (!response.data.ok) {
                logger.error(`[AIEscalationManager] Slack API error: ${response.data.error}`);
                return [];
            }

            // Return all messages except the parent (first one)
            return response.data.messages?.slice(1) || [];
        } catch (error) {
            logger.error(`[AIEscalationManager] Error fetching thread messages:`, error);
            return [];
        }
    }
}
