import { Request, Response } from 'express';
import { appDatabase } from '../utils/database.util';
import { AIEscalationLog } from '../entity/AIEscalationLog';
import { ZapierTriggerEvent } from '../entity/ZapierTriggerEvent';
import { Employee, EmployeeDepartment } from '../entity/Employee';
import { EmployeeScheduleEntry, EmployeeScheduleShiftType } from '../entity/EmployeeScheduleEntry';
import { LeaveRequestEntity } from '../entity/LeaveRequest';
import { Between, In, Like } from 'typeorm';
import logger from '../utils/logger.utils';
import OpenAI from 'openai';
import axios from 'axios';

const logRepo = appDatabase.getRepository(AIEscalationLog);
const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const REPORT_TIME_ZONE = 'America/New_York';

const getOpenAI = () => {
    if (!OPENAI_API_KEY) return null;
    return new OpenAI({ apiKey: OPENAI_API_KEY });
};

const buildSlackPermalink = (channel: string | null, ts: string | null): string | null => {
    const workspaceUrl = process.env.SLACK_WORKSPACE_URL;
    if (!workspaceUrl || !channel || !ts) return null;
    const normalizedWorkspace = workspaceUrl.endsWith('/') ? workspaceUrl.slice(0, -1) : workspaceUrl;
    return `${normalizedWorkspace}/archives/${channel}/p${ts.replace('.', '')}`;
};

const parseSlackTs = (ts: string | null | undefined): number => {
    if (!ts) return 0;
    const parsed = Number(ts);
    return Number.isFinite(parsed) ? parsed : 0;
};

const isCandidateAIDelete = (log: AIEscalationLog) => {
    return ['REMIND', 'ASK_UPDATE', 'ESCALATE'].includes(log.decision);
};

const resolveSlackMessageTarget = async (log: AIEscalationLog): Promise<{ channel: string; ts: string } | null> => {
    const event = await eventRepo.findOne({ where: { id: log.taskId } });
    const rootTs = event?.slackThreadTs || null;
    const rootChannel = event?.slackChannelId || null;

    if (log.slackChannelId && log.slackMessageTs) {
        if (rootTs && log.slackMessageTs === rootTs) {
            throw new Error('Refusing to delete the root GR task message.');
        }

        return {
            channel: log.slackChannelId,
            ts: log.slackMessageTs
        };
    }

    if (!SLACK_BOT_TOKEN) {
        throw new Error('SLACK_BOT_TOKEN is not configured.');
    }

    if (!event?.slackThreadTs || !(event.slackChannelId || log.slackChannelId || rootChannel)) {
        return null;
    }

    if (!log.message?.trim()) {
        return null;
    }

    const channel = event.slackChannelId || log.slackChannelId || rootChannel;
    if (!channel) return null;

    const response = await axios.get('https://slack.com/api/conversations.replies', {
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        params: {
            channel,
            ts: event.slackThreadTs,
            limit: 200
        }
    });

    if (!response.data?.ok) {
        throw new Error(`Slack thread lookup failed: ${response.data?.error || 'unknown_error'}`);
    }

    const logCreated = log.createdAt ? new Date(log.createdAt).getTime() / 1000 : 0;
    const logMessage = log.message.trim().toLowerCase();
    const messages = (response.data.messages || []).slice(1);

    const candidates = messages
        .filter((message: any) => {
            if (!message?.bot_id || !message?.ts || message.ts === rootTs) return false;
            const text = String(message.text || '').toLowerCase();
            return text.includes(logMessage);
        })
        .map((message: any) => ({
            ts: message.ts as string,
            score: Math.abs(parseSlackTs(message.ts) - logCreated)
        }))
        .sort((a: { ts: string; score: number }, b: { ts: string; score: number }) => a.score - b.score);

    if (!candidates.length) {
        return null;
    }

    return {
        channel,
        ts: candidates[0].ts
    };
};

const deleteSlackMessageForLog = async (log: AIEscalationLog): Promise<{ channel: string; ts: string }> => {
    if (!isCandidateAIDelete(log)) {
        throw new Error('Only AI follow-up Slack messages can be deleted from this page.');
    }

    if (!SLACK_BOT_TOKEN) {
        throw new Error('SLACK_BOT_TOKEN is not configured.');
    }

    const target = await resolveSlackMessageTarget(log);
    if (!target) {
        throw new Error('Could not locate the AI Slack message for this log.');
    }

    const response = await axios.post(
        'https://slack.com/api/chat.delete',
        { channel: target.channel, ts: target.ts },
        {
            headers: {
                Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            }
        }
    );

    if (!response.data?.ok) {
        throw new Error(`Slack delete failed: ${response.data?.error || 'unknown_error'}`);
    }

    return target;
};

type ParsedEmployeeSchedule = {
    days?: number[];
    constantStart?: string | null;
    constantEnd?: string | null;
    effectiveStartDate?: string | null;
    overrides?: Record<string, { start?: string | null; end?: string | null }>;
};

type PerformanceAccumulator = {
    repName: string;
    tasksAssigned: number;
    completedTasks: number;
    overdueTasks: number;
    totalResponseHours: number;
    responseSamples: number;
    totalResolutionHours: number;
    resolutionSamples: number;
    escalationCount: number;
    neglectCount: number;
    completionQualityTotal: number;
    completionQualitySamples: number;
    completionQualityMin: number | null;
    completionQualityMax: number | null;
    completionQualityReasons: string[];
    completedOutsideShiftTasks: number;
    recentTaskIds: number[];
};

const normalizeIdentity = (value?: string | null) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^<@|>$/g, '')
        .replace(/^@/, '')
        .replace(/\s+\(via slack\)$/i, '')
        .replace(/\s+/g, ' ');

const employeeDisplayName = (employee: Employee) => {
    const preferred = employee.preferredName?.trim();
    const fullName = [employee.user?.firstName, employee.user?.lastName].filter(Boolean).join(' ').trim();
    return preferred || fullName || `Employee #${employee.id}`;
};

const buildEmployeeIdentityMap = (employees: Employee[]) => {
    const map = new Map<string, Employee>();
    employees.forEach(employee => {
        [
            employeeDisplayName(employee),
            employee.preferredName,
            employee.user?.firstName,
            [employee.user?.firstName, employee.user?.lastName].filter(Boolean).join(' ').trim(),
            employee.user?.email,
            employee.user?.uid,
            employee.slackUserId,
            employee.slackId,
        ].forEach(value => {
            const key = normalizeIdentity(value);
            if (key) map.set(key, employee);
        });
    });
    return map;
};

const getNewYorkParts = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: REPORT_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);
    const get = (type: string) => parts.find(part => part.type === type)?.value || '';
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const hour = Number(get('hour') || 0);
    const minute = Number(get('minute') || 0);
    return {
        dateKey: `${get('year')}-${get('month')}-${get('day')}`,
        dayOfWeek: weekdayMap[get('weekday')] ?? 0,
        minutes: hour * 60 + minute
    };
};

const addDaysToDateKey = (dateKey: string, days: number) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

const getDayOfWeekFromDateKey = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(year, (month || 1) - 1, day || 1)).getUTCDay();
};

const parseTimeToMinutes = (time?: string | null) => {
    if (!time) return null;
    const match = String(time).trim().match(/^(\d{1,2})(?::(\d{2}))?/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2] || 0);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
};

const parseSchedule = (schedule?: string | null): ParsedEmployeeSchedule | null => {
    if (!schedule) return null;
    try {
        const parsed = JSON.parse(schedule);
        return Array.isArray(parsed?.days) ? parsed : null;
    } catch {
        return null;
    }
};

const getDateKeyFromDbDate = (value: any) => {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
};

const toDateOrNull = (value: any): Date | null => {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildOverrideDate = (override: EmployeeScheduleEntry, edge: 'start' | 'end') => {
    const explicit = edge === 'start' ? override.shiftStartAt : override.shiftEndAt;
    if (explicit) return toDateOrNull(explicit);
    const time = edge === 'start' ? override.shiftStart : override.shiftEnd;
    const date = toDateOrNull(`${getDateKeyFromDbDate(override.date)}T${time || '00:00:00'}`);
    if (edge === 'end' && date && override.shiftStart && override.shiftEnd && override.shiftEnd <= override.shiftStart) {
        date.setDate(date.getDate() + 1);
    }
    return date;
};

const isOnApprovedLeave = (
    employee: Employee,
    dateKey: string,
    leaveByUserId: Map<number, Array<{ startDate: string; endDate: string }>>
) => {
    const leaves = leaveByUserId.get(employee.userId) || [];
    return leaves.some(leave => leave.startDate <= dateKey && leave.endDate >= dateKey);
};

const isEmployeeOnShiftAt = (
    employee: Employee,
    at: Date,
    overridesByEmployeeDate: Map<string, EmployeeScheduleEntry>,
    leaveByUserId: Map<number, Array<{ startDate: string; endDate: string }>>
) => {
    const current = getNewYorkParts(at);
    const candidateDateKeys = [current.dateKey, addDaysToDateKey(current.dateKey, -1)];

    for (const candidateDateKey of candidateDateKeys) {
        if (isOnApprovedLeave(employee, candidateDateKey, leaveByUserId)) continue;

        const override = overridesByEmployeeDate.get(`${employee.id}-${candidateDateKey}`);
        if (override) {
            if (override.shiftType !== EmployeeScheduleShiftType.REGULAR) continue;
            const start = buildOverrideDate(override, 'start');
            const end = buildOverrideDate(override, 'end');
            if (start && end && at.getTime() >= start.getTime() && at.getTime() < end.getTime()) return true;
            continue;
        }

        const schedule = parseSchedule(employee.schedule);
        if (!schedule) continue;
        if (schedule.effectiveStartDate && candidateDateKey < schedule.effectiveStartDate) continue;

        const dayOfWeek = getDayOfWeekFromDateKey(candidateDateKey);
        const days = (schedule.days || []).map(Number);
        if (!days.includes(dayOfWeek)) continue;

        const dayOverride = schedule.overrides?.[String(dayOfWeek)] || schedule.overrides?.[dayOfWeek as any];
        const startMinutes = parseTimeToMinutes(dayOverride?.start || schedule.constantStart);
        const endMinutes = parseTimeToMinutes(dayOverride?.end || schedule.constantEnd);
        if (startMinutes === null || endMinutes === null) continue;

        const endAdjusted = endMinutes <= startMinutes ? endMinutes + 1440 : endMinutes;
        const dayOffset = candidateDateKey === current.dateKey ? 0 : 1;
        const minutesFromShiftDate = dayOffset * 1440 + current.minutes;
        if (minutesFromShiftDate >= startMinutes && minutesFromShiftDate < endAdjusted) return true;
    }

    return false;
};

const createPerformanceAccumulator = (repName: string): PerformanceAccumulator => ({
    repName,
    tasksAssigned: 0,
    completedTasks: 0,
    overdueTasks: 0,
    totalResponseHours: 0,
    responseSamples: 0,
    totalResolutionHours: 0,
    resolutionSamples: 0,
    escalationCount: 0,
    neglectCount: 0,
    completionQualityTotal: 0,
    completionQualitySamples: 0,
    completionQualityMin: null,
    completionQualityMax: null,
    completionQualityReasons: [],
    completedOutsideShiftTasks: 0,
    recentTaskIds: []
});

const ensureStatusHistoryTableForPerformance = async () => {
    await appDatabase.query(`
        CREATE TABLE IF NOT EXISTS zapier_trigger_event_status_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            event_id INT NOT NULL,
            previous_status VARCHAR(50) NULL,
            status VARCHAR(50) NOT NULL,
            changed_by VARCHAR(255) NULL,
            changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_ztesh_event_changed (event_id, changed_at),
            INDEX idx_ztesh_status_changed (status, changed_at),
            CONSTRAINT fk_ztesh_event
                FOREIGN KEY (event_id)
                REFERENCES zapier_trigger_events(id)
                ON DELETE CASCADE
        )
    `);
};

/**
 * Get AI escalation logs with filtering and pagination
 */
export const getLogs = async (req: Request, res: Response) => {
    try {
        const { 
            page = 1, 
            limit = 50, 
            decision, 
            aiMode, 
            slackChannel,
            eventType,
            executed,
            startDate,
            endDate,
            taskId,
            statuses
        } = req.query;

        // Use query builder for complex filtering (status join)
        const qb = logRepo.createQueryBuilder('log');

        // Decision filter (supports comma-separated multi-select)
        if (decision) {
            const decisions = (decision as string).split(',').filter(Boolean);
            if (decisions.length > 1) {
                qb.andWhere('log.decision IN (:...decisions)', { decisions });
            } else {
                qb.andWhere('log.decision = :decision', { decision: decisions[0] });
            }
        }
        if (aiMode) qb.andWhere('log.aiMode = :aiMode', { aiMode });
        // Slack channel filter (supports comma-separated multi-select)
        if (slackChannel) {
            const channels = (slackChannel as string).split(',').filter(Boolean);
            if (channels.length > 1) {
                qb.andWhere('log.slackChannel IN (:...channels)', { channels });
            } else {
                qb.andWhere('log.slackChannel = :slackChannel', { slackChannel: channels[0] });
            }
        }
        if (eventType) qb.andWhere('log.eventType = :eventType', { eventType });
        if (executed !== undefined) qb.andWhere('log.executed = :executed', { executed: executed === 'true' });
        if (taskId) qb.andWhere('log.taskId = :taskId', { taskId: Number(taskId) });

        if (startDate || endDate) {
            const start = startDate ? new Date(startDate as string) : new Date('2020-01-01');
            const end = endDate ? new Date(endDate as string) : new Date();
            qb.andWhere('log.createdAt BETWEEN :start AND :end', { start, end });
        }

        // Filter by associated task status (via subquery on zapier_trigger_events)
        if (statuses) {
            const statusList = (statuses as string).split(',').filter(Boolean);
            if (statusList.length > 0) {
                qb.andWhere(
                    'log.taskId IN (SELECT id FROM zapier_trigger_events WHERE status IN (:...statusList))',
                    { statusList }
                );
            }
        }

        qb.orderBy('log.createdAt', 'DESC')
            .skip((Number(page) - 1) * Number(limit))
            .take(Number(limit));

        const [logs, total] = await qb.getManyAndCount();

        res.json({
            logs,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / Number(limit))
            }
        });
    } catch (error) {
        logger.error('[AILogController] Error fetching logs:', error);
        res.status(500).json({ error: 'Failed to fetch AI logs' });
    }
};

/**
 * Get AI decision statistics
 */
export const getStats = async (req: Request, res: Response) => {
    try {
        const { days = 7 } = req.query;
        const since = new Date();
        since.setDate(since.getDate() - Number(days));

        // Get decision breakdown
        const decisionStats = await logRepo
            .createQueryBuilder('log')
            .select('log.decision', 'decision')
            .addSelect('COUNT(*)', 'count')
            .where('log.createdAt >= :since', { since })
            .groupBy('log.decision')
            .getRawMany();

        // Get mode breakdown
        const modeStats = await logRepo
            .createQueryBuilder('log')
            .select('log.aiMode', 'mode')
            .addSelect('COUNT(*)', 'count')
            .where('log.createdAt >= :since', { since })
            .groupBy('log.aiMode')
            .getRawMany();

        // Get execution success rate
        const executionStats = await logRepo
            .createQueryBuilder('log')
            .select('log.executed', 'executed')
            .addSelect('COUNT(*)', 'count')
            .where('log.createdAt >= :since', { since })
            .groupBy('log.executed')
            .getRawMany();

        // Get channel breakdown
        const channelStats = await logRepo
            .createQueryBuilder('log')
            .select('log.slackChannel', 'channel')
            .addSelect('COUNT(*)', 'count')
            .where('log.createdAt >= :since', { since })
            .andWhere('log.slackChannel IS NOT NULL')
            .groupBy('log.slackChannel')
            .orderBy('count', 'DESC')
            .limit(10)
            .getRawMany();

        // Get daily trend
        const dailyTrend = await logRepo
            .createQueryBuilder('log')
            .select("DATE(log.createdAt)", 'date')
            .addSelect('COUNT(*)', 'count')
            .where('log.createdAt >= :since', { since })
            .groupBy('date')
            .orderBy('date', 'ASC')
            .getRawMany();

        // Total count
        const totalCount = await logRepo.count({
            where: { createdAt: Between(since, new Date()) }
        });

        res.json({
            period: `Last ${days} days`,
            totalDecisions: totalCount,
            byDecision: decisionStats,
            byMode: modeStats,
            byExecution: executionStats,
            byChannel: channelStats,
            dailyTrend
        });
    } catch (error) {
        logger.error('[AILogController] Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch AI stats' });
    }
};

/**
 * Get a single log entry with full details
 */
export const getLogById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        
        const log = await logRepo.findOne({ where: { id: Number(id) } });
        
        if (!log) {
            return res.status(404).json({ error: 'Log not found' });
        }

        res.json(log);
    } catch (error) {
        logger.error('[AILogController] Error fetching log:', error);
        res.status(500).json({ error: 'Failed to fetch log' });
    }
};

/**
 * Get logs for a specific task
 */
export const getLogsByTask = async (req: Request, res: Response) => {
    try {
        const { taskId } = req.params;
        
        const logs = await logRepo.find({
            where: { taskId: Number(taskId) },
            order: { createdAt: 'DESC' }
        });

        res.json(logs);
    } catch (error) {
        logger.error('[AILogController] Error fetching task logs:', error);
        res.status(500).json({ error: 'Failed to fetch task logs' });
    }
};

/**
 * Submit feedback on an AI decision
 */
export const submitFeedback = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { feedback, rating, feedbackType, expectedBehavior, scope, managerComment } = req.body;
        const userId = (req as any).user?.id || (req as any).userId;

        if (!feedback) {
            return res.status(400).json({ error: 'Feedback is required' });
        }

        if (rating && !['positive', 'negative', 'neutral'].includes(rating)) {
            return res.status(400).json({ error: 'Invalid rating. Must be: positive, negative, or neutral' });
        }

        const log = await logRepo.findOne({ where: { id: Number(id) } });
        
        if (!log) {
            return res.status(404).json({ error: 'AI log not found' });
        }

        // Update the log with feedback
        log.feedback = feedback;
        log.feedbackRating = rating || 'neutral';
        log.feedbackBy = userId || null;
        log.feedbackAt = new Date();
        log.feedbackType = feedbackType || null;
        log.expectedBehavior = expectedBehavior || null;
        log.feedbackScope = scope || 'global';
        log.managerComment = managerComment || feedback;

        await logRepo.save(log);

        logger.info(`[AILogController] Feedback submitted for log ${id}: ${rating} - ${feedback.substring(0, 100)}`);

        res.json({ 
            success: true, 
            message: 'Feedback submitted successfully',
            data: log
        });
    } catch (error) {
        logger.error('[AILogController] Error submitting feedback:', error);
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
};

export const deleteLog = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const log = await logRepo.findOne({ where: { id: Number(id) } });

        if (!log) {
            return res.status(404).json({ error: 'AI log not found' });
        }

        const deletedTarget = await deleteSlackMessageForLog(log);
        await logRepo.delete({ id: log.id });

        return res.json({
            success: true,
            deletedLogId: log.id,
            slack: {
                channel: deletedTarget.channel,
                ts: deletedTarget.ts,
                permalink: buildSlackPermalink(deletedTarget.channel, deletedTarget.ts)
            }
        });
    } catch (error: any) {
        logger.error('[AILogController] Error deleting AI log/message:', error);
        return res.status(400).json({ error: error?.message || 'Failed to delete AI message' });
    }
};

export const bulkDeleteLogs = async (req: Request, res: Response) => {
    try {
        const ids = Array.isArray(req.body?.ids)
            ? req.body.ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id))
            : [];

        if (!ids.length) {
            return res.status(400).json({ error: 'ids is required' });
        }

        const logs = await logRepo.find({ where: { id: In(ids) } });
        const deleted: Array<{ id: number; channel: string; ts: string }> = [];
        const failed: Array<{ id: number; error: string }> = [];

        for (const log of logs) {
            try {
                const target = await deleteSlackMessageForLog(log);
                await logRepo.delete({ id: log.id });
                deleted.push({ id: log.id, channel: target.channel, ts: target.ts });
            } catch (error: any) {
                failed.push({ id: log.id, error: error?.message || 'Failed to delete AI message' });
            }
        }

        return res.json({
            success: failed.length === 0,
            deletedCount: deleted.length,
            failedCount: failed.length,
            deleted,
            failed
        });
    } catch (error) {
        logger.error('[AILogController] Error bulk deleting AI logs/messages:', error);
        return res.status(500).json({ error: 'Failed to bulk delete AI messages' });
    }
};

const getPerformanceRows = async (days: number) => {
    const since = new Date();
    since.setDate(since.getDate() - days);

    await ensureStatusHistoryTableForPerformance();

    const [employees, scheduleOverrides, leaveRows, events] = await Promise.all([
        appDatabase.getRepository(Employee).find({
            where: { department: EmployeeDepartment.GUEST_RELATIONS, isActive: true },
            relations: ['user']
        }),
        appDatabase.getRepository(EmployeeScheduleEntry).find({
            where: { isRecurring: false },
            order: { date: 'ASC' }
        }),
        appDatabase.getRepository(LeaveRequestEntity)
            .createQueryBuilder('leave')
            .where('leave.deletedAt IS NULL')
            .andWhere('leave.status IN (:...statuses)', { statuses: ['approved', 'cancellation_pending'] })
            .getMany(),
        appDatabase.query(
        `SELECT
            e.id,
            e.status,
            e.created_at,
            e.updated_at,
            e.completed_on,
            e.completion_quality_score,
            e.last_ai_review_summary,
            e.ignored_prompt_count,
            e.is_overdue,
            e.updated_by,
            (
                SELECT tm.user_name
                FROM thread_messages tm
                WHERE tm.gr_task_id = e.id
                  AND tm.user_name IS NOT NULL
                  AND tm.user_name <> ''
                  AND tm.user_name <> 'AI Manager'
                ORDER BY tm.message_timestamp DESC
                LIMIT 1
            ) AS latest_rep_name,
            (
                SELECT MIN(tm.message_timestamp)
                FROM thread_messages tm
                WHERE tm.gr_task_id = e.id
                  AND tm.user_name IS NOT NULL
                  AND tm.user_name <> ''
                  AND tm.user_name <> 'AI Manager'
            ) AS first_rep_reply_at,
            (
                SELECT MIN(sh.changed_at)
                FROM zapier_trigger_event_status_history sh
                WHERE sh.event_id = e.id
                  AND sh.status = 'In Progress'
            ) AS first_in_progress_at,
            (
                SELECT sh.changed_by
                FROM zapier_trigger_event_status_history sh
                WHERE sh.event_id = e.id
                  AND sh.status = 'Completed'
                ORDER BY sh.changed_at DESC, sh.id DESC
                LIMIT 1
            ) AS completed_by,
            (
                SELECT sh.changed_at
                FROM zapier_trigger_event_status_history sh
                WHERE sh.event_id = e.id
                  AND sh.status = 'Completed'
                ORDER BY sh.changed_at DESC, sh.id DESC
                LIMIT 1
            ) AS completed_status_at,
            (
                SELECT COUNT(*)
                FROM ai_escalation_logs log
                WHERE log.task_id = e.id
                  AND log.decision = 'ESCALATE'
            ) AS escalation_count
        FROM zapier_trigger_events e
        WHERE e.created_at >= ?`,
        [since]
        )
    ]);

    const overridesByEmployeeDate = new Map<string, EmployeeScheduleEntry>();
    scheduleOverrides.forEach(override => {
        overridesByEmployeeDate.set(`${override.employeeId}-${getDateKeyFromDbDate(override.date)}`, override);
    });

    const leaveByUserId = new Map<number, Array<{ startDate: string; endDate: string }>>();
    leaveRows.forEach(leave => {
        const dates = leaveByUserId.get(leave.userId) || [];
        dates.push({
            startDate: getDateKeyFromDbDate(leave.startDate),
            endDate: getDateKeyFromDbDate(leave.endDate)
        });
        leaveByUserId.set(leave.userId, dates);
    });

    const identityMap = buildEmployeeIdentityMap(employees);

    const byRep = new Map<string, PerformanceAccumulator>();
    const getRep = (repName: string) => {
        const existing = byRep.get(repName);
        if (existing) return existing;
        const created = createPerformanceAccumulator(repName);
        byRep.set(repName, created);
        return created;
    };

    for (const row of events) {
        const createdAt = new Date(row.created_at);
        const completedAt = row.completed_status_at || row.completed_on ? new Date(row.completed_status_at || row.completed_on) : null;
        const activeShiftEmployees = employees.filter(employee =>
            isEmployeeOnShiftAt(employee, createdAt, overridesByEmployeeDate, leaveByUserId)
        );
        const targetReps = activeShiftEmployees.length ? activeShiftEmployees : [];
        const fallbackRep = targetReps.length ? null : getRep('Unassigned / No active GR shift');
        const repsForTask = targetReps.map(employee => getRep(employeeDisplayName(employee)));
        if (fallbackRep) repsForTask.push(fallbackRep);

        const firstReplyAt = row.first_rep_reply_at ? new Date(row.first_rep_reply_at) : null;
        const firstInProgressAt = row.first_in_progress_at ? new Date(row.first_in_progress_at) : null;
        const responseAt = [firstReplyAt, firstInProgressAt]
            .filter((value): value is Date => Boolean(value) && !Number.isNaN(value.getTime()))
            .sort((a, b) => a.getTime() - b.getTime())[0] || null;

        repsForTask.forEach(current => {
            current.tasksAssigned += 1;
            if (row.status === 'Completed') current.completedTasks += 1;
            if (row.is_overdue) current.overdueTasks += 1;
            current.escalationCount += Number(row.escalation_count || 0);
            current.neglectCount += Number(row.ignored_prompt_count || 0);

            if (responseAt) {
                const responseHours = (responseAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
                if (Number.isFinite(responseHours) && responseHours >= 0) {
                    current.totalResponseHours += responseHours;
                    current.responseSamples += 1;
                }
            }

            if (completedAt && !Number.isNaN(completedAt.getTime())) {
                const resolutionHours = (completedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
                if (Number.isFinite(resolutionHours) && resolutionHours >= 0) {
                    current.totalResolutionHours += resolutionHours;
                    current.resolutionSamples += 1;
                }
            }

            if (row.completion_quality_score !== null && row.completion_quality_score !== undefined) {
                const quality = Number(row.completion_quality_score);
                current.completionQualityTotal += quality;
                current.completionQualitySamples += 1;
                current.completionQualityMin = current.completionQualityMin === null ? quality : Math.min(current.completionQualityMin, quality);
                current.completionQualityMax = current.completionQualityMax === null ? quality : Math.max(current.completionQualityMax, quality);
                const reason = String(row.last_ai_review_summary || '').trim();
                if (reason && !current.completionQualityReasons.includes(reason) && current.completionQualityReasons.length < 3) {
                    current.completionQualityReasons.push(reason);
                }
            }

            current.recentTaskIds.push(row.id);
        });

        const completionActorKey = normalizeIdentity(row.completed_by || row.updated_by || row.latest_rep_name);
        const completionEmployee = completionActorKey ? identityMap.get(completionActorKey) : null;
        if (completionEmployee && completedAt && !Number.isNaN(completedAt.getTime())) {
            const completedOnShift = isEmployeeOnShiftAt(completionEmployee, completedAt, overridesByEmployeeDate, leaveByUserId);
            if (!completedOnShift) {
                getRep(employeeDisplayName(completionEmployee)).completedOutsideShiftTasks += 1;
            }
        }
    }

    return Array.from(byRep.values())
        .map(rep => {
            const qualityScore = rep.completionQualitySamples ? rep.completionQualityTotal / rep.completionQualitySamples : null;
            const reasonSummary = rep.completionQualityReasons.length
                ? ` Review notes: ${rep.completionQualityReasons.join(' | ')}`
                : '';
            const completionQualityExplanation = rep.completionQualitySamples
                ? `Average of ${rep.completionQualitySamples} completion quality score${rep.completionQualitySamples === 1 ? '' : 's'} from tasks created during this employee's active GR shifts. Tasks without a score are excluded.${rep.completionQualityMin !== null && rep.completionQualityMax !== null ? ` Score range: ${Math.round(rep.completionQualityMin * 100)}%-${Math.round(rep.completionQualityMax * 100)}%.` : ''}${reasonSummary}`
                : 'No completion quality scores were available for tasks created during this employee\'s active GR shifts.';
            return {
                repName: rep.repName,
                tasksAssigned: rep.tasksAssigned,
                completionRate: rep.tasksAssigned ? rep.completedTasks / rep.tasksAssigned : 0,
                overdueRate: rep.tasksAssigned ? rep.overdueTasks / rep.tasksAssigned : 0,
                avgResponseTimeHours: rep.responseSamples ? rep.totalResponseHours / rep.responseSamples : null,
                avgResolutionTimeHours: rep.resolutionSamples ? rep.totalResolutionHours / rep.resolutionSamples : null,
                escalationRate: rep.tasksAssigned ? rep.escalationCount / rep.tasksAssigned : 0,
                neglectRate: rep.tasksAssigned ? rep.neglectCount / rep.tasksAssigned : 0,
                completionQualityScore: qualityScore,
                completionQualitySamples: rep.completionQualitySamples,
                completionQualityExplanation,
                completedOutsideShiftTasks: rep.completedOutsideShiftTasks,
                recentTaskIds: rep.recentTaskIds.slice(-10)
            };
        })
        .sort((a, b) => b.tasksAssigned - a.tasksAssigned);
};

export const getAssistantPerformance = async (req: Request, res: Response) => {
    try {
        const days = Number(req.query.days || 30);
        const reps = await getPerformanceRows(days);

        const totals = reps.reduce((acc, rep) => {
            acc.tasks += rep.tasksAssigned;
            acc.escalations += rep.escalationRate * rep.tasksAssigned;
            return acc;
        }, { tasks: 0, escalations: 0 });

        res.json({
            scope: 'GR tasks created during each active Guest Relations shift in America/New_York',
            timeRange: `Last ${days} days`,
            taskCount: totals.tasks,
            reps
        });
    } catch (error) {
        logger.error('[AILogController] Error fetching assistant performance:', error);
        res.status(500).json({ error: 'Failed to fetch AI Manager assistant performance data' });
    }
};

export const assistantChat = async (req: Request, res: Response) => {
    try {
        const { question, days = 30 } = req.body || {};
        if (!question || typeof question !== 'string') {
            return res.status(400).json({ error: 'question is required' });
        }

        const rows = await getPerformanceRows(Number(days));
        const q = question.toLowerCase();

        let selectedRows = rows;
        let headline = 'General GR performance snapshot';

        if (q.includes('missing the most follow-ups') || q.includes('neglect')) {
            selectedRows = [...rows].sort((a, b) => b.neglectRate - a.neglectRate).slice(0, 5);
            headline = 'Highest neglect / missed follow-up risk';
        } else if (q.includes('completed poorly') || q.includes('poorly')) {
            selectedRows = [...rows].sort((a, b) => (a.completionQualityScore ?? 1) - (b.completionQualityScore ?? 1)).slice(0, 5);
            headline = 'Lowest completion quality';
        } else if (q.includes('need improvement') || q.includes('improvement')) {
            selectedRows = [...rows]
                .sort((a, b) => (b.overdueRate + b.escalationRate + b.neglectRate) - (a.overdueRate + a.escalationRate + a.neglectRate))
                .slice(0, 5);
            headline = 'Reps needing the most operational coaching';
        }

        const dataScope = {
            scope: 'GR tasks created during active Guest Relations shifts in America/New_York; response timing uses first human thread reply or first In Progress status change',
            timeRange: `Last ${days} days`,
            tasksAnalyzed: rows.reduce((sum, row) => sum + row.tasksAssigned, 0)
        };

        const factualSummary = selectedRows.map(row => ({
            repName: row.repName,
            tasksAssigned: row.tasksAssigned,
            completionRate: Number((row.completionRate * 100).toFixed(1)),
            overdueRate: Number((row.overdueRate * 100).toFixed(1)),
            escalationRate: Number((row.escalationRate * 100).toFixed(1)),
            neglectRate: Number((row.neglectRate * 100).toFixed(1)),
            completionQualityScore: row.completionQualityScore === null ? null : Number((row.completionQualityScore * 100).toFixed(1)),
            completedOutsideShiftTasks: row.completedOutsideShiftTasks,
            completionQualityExplanation: row.completionQualityExplanation
        }));

        let answer = `${headline}\n\n`;
        if (factualSummary.length === 0) {
            answer += 'No matching GR task activity was found in the selected time range.';
        } else {
            answer += factualSummary
                .map(row => `- ${row.repName}: ${row.tasksAssigned} tasks, ${row.completionRate}% completion, ${row.overdueRate}% overdue, ${row.escalationRate}% escalation, ${row.neglectRate}% neglect, completion quality ${row.completionQualityScore ?? 'n/a'}%, ${row.completedOutsideShiftTasks} completions outside shift`)
                .join('\n');
        }

        const openai = getOpenAI();
        if (openai) {
            try {
                const response = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an AI manager assistant. Summarize operational findings using only the supplied data. Do not invent metrics.'
                        },
                        {
                            role: 'user',
                            content: `Question: ${question}\n\nData scope: ${JSON.stringify(dataScope)}\n\nFacts:\n${JSON.stringify(factualSummary)}`
                        }
                    ],
                    temperature: 0.2,
                    max_tokens: 220
                });

                answer = response.choices[0]?.message?.content?.trim() || answer;
            } catch (aiError) {
                logger.warn('[AILogController] Assistant chat summarization failed, using raw answer:', aiError);
            }
        }

        res.json({
            dataScope,
            rows: factualSummary,
            answer
        });
    } catch (error) {
        logger.error('[AILogController] Error in assistant chat:', error);
        res.status(500).json({ error: 'Failed to answer AI Manager assistant question' });
    }
};

/**
 * Get feedback statistics for AI improvement
 */
export const getFeedbackStats = async (req: Request, res: Response) => {
    try {
        const { days = 30 } = req.query;
        const since = new Date();
        since.setDate(since.getDate() - Number(days));

        // Get feedback breakdown by rating
        const ratingStats = await logRepo
            .createQueryBuilder('log')
            .select('log.feedbackRating', 'rating')
            .addSelect('COUNT(*)', 'count')
            .where('log.feedbackAt >= :since', { since })
            .andWhere('log.feedbackRating IS NOT NULL')
            .groupBy('log.feedbackRating')
            .getRawMany();

        // Get feedback breakdown by decision type
        const decisionFeedback = await logRepo
            .createQueryBuilder('log')
            .select('log.decision', 'decision')
            .addSelect('log.feedbackRating', 'rating')
            .addSelect('COUNT(*)', 'count')
            .where('log.feedbackAt >= :since', { since })
            .andWhere('log.feedbackRating IS NOT NULL')
            .groupBy('log.decision')
            .addGroupBy('log.feedbackRating')
            .getRawMany();

        // Get recent feedback messages for review
        const recentFeedback = await logRepo.find({
            where: {
                feedbackAt: Between(since, new Date())
            },
            order: { feedbackAt: 'DESC' },
            take: 20,
            select: ['id', 'taskId', 'decision', 'message', 'feedback', 'feedbackRating', 'feedbackAt']
        });

        // Count total feedback received
        const totalFeedback = await logRepo.count({
            where: {
                feedbackAt: Between(since, new Date())
            }
        });

        res.json({
            period: `Last ${days} days`,
            totalFeedback,
            byRating: ratingStats,
            byDecision: decisionFeedback,
            recentFeedback
        });
    } catch (error) {
        logger.error('[AILogController] Error fetching feedback stats:', error);
        res.status(500).json({ error: 'Failed to fetch feedback statistics' });
    }
};
