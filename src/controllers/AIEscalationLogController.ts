import { Request, Response } from 'express';
import { appDatabase } from '../utils/database.util';
import { AIEscalationLog } from '../entity/AIEscalationLog';
import { Between, In, Like } from 'typeorm';
import logger from '../utils/logger.utils';
import OpenAI from 'openai';

const logRepo = appDatabase.getRepository(AIEscalationLog);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const getOpenAI = () => {
    if (!OPENAI_API_KEY) return null;
    return new OpenAI({ apiKey: OPENAI_API_KEY });
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

const getPerformanceRows = async (days: number) => {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const events = await appDatabase.query(
        `SELECT
            e.id,
            e.status,
            e.created_at,
            e.updated_at,
            e.completed_on,
            e.completion_quality_score,
            e.ignored_prompt_count,
            e.is_overdue,
            e.assigned_rep_name,
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
                SELECT COUNT(*)
                FROM ai_escalation_logs log
                WHERE log.task_id = e.id
                  AND log.decision = 'ESCALATE'
            ) AS escalation_count
        FROM zapier_trigger_events e
        WHERE e.created_at >= ?`,
        [since]
    );

    const byRep = new Map<string, any>();

    for (const row of events) {
        const repName = row.assigned_rep_name || row.latest_rep_name || 'Unassigned / No rep reply';
        const current = byRep.get(repName) || {
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
            recentTaskIds: []
        };

        current.tasksAssigned += 1;
        if (row.status === 'Completed') current.completedTasks += 1;
        if (row.is_overdue) current.overdueTasks += 1;
        current.escalationCount += Number(row.escalation_count || 0);
        current.neglectCount += Number(row.ignored_prompt_count || 0);

        if (row.first_rep_reply_at) {
            const responseHours = (new Date(row.first_rep_reply_at).getTime() - new Date(row.created_at).getTime()) / (1000 * 60 * 60);
            if (Number.isFinite(responseHours) && responseHours >= 0) {
                current.totalResponseHours += responseHours;
                current.responseSamples += 1;
            }
        }

        if (row.completed_on) {
            const resolutionHours = (new Date(row.completed_on).getTime() - new Date(row.created_at).getTime()) / (1000 * 60 * 60);
            if (Number.isFinite(resolutionHours) && resolutionHours >= 0) {
                current.totalResolutionHours += resolutionHours;
                current.resolutionSamples += 1;
            }
        }

        if (row.completion_quality_score !== null && row.completion_quality_score !== undefined) {
            current.completionQualityTotal += Number(row.completion_quality_score);
            current.completionQualitySamples += 1;
        }

        current.recentTaskIds.push(row.id);
        byRep.set(repName, current);
    }

    return Array.from(byRep.values())
        .map(rep => ({
            repName: rep.repName,
            tasksAssigned: rep.tasksAssigned,
            completionRate: rep.tasksAssigned ? rep.completedTasks / rep.tasksAssigned : 0,
            overdueRate: rep.tasksAssigned ? rep.overdueTasks / rep.tasksAssigned : 0,
            avgResponseTimeHours: rep.responseSamples ? rep.totalResponseHours / rep.responseSamples : null,
            avgResolutionTimeHours: rep.resolutionSamples ? rep.totalResolutionHours / rep.resolutionSamples : null,
            escalationRate: rep.tasksAssigned ? rep.escalationCount / rep.tasksAssigned : 0,
            neglectRate: rep.tasksAssigned ? rep.neglectCount / rep.tasksAssigned : 0,
            completionQualityScore: rep.completionQualitySamples ? rep.completionQualityTotal / rep.completionQualitySamples : null,
            recentTaskIds: rep.recentTaskIds.slice(-10)
        }))
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
            scope: 'GR tasks with latest known rep engagement',
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
            scope: 'GR tasks, thread activity, AI decisions, and completion review data',
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
            completionQualityScore: row.completionQualityScore === null ? null : Number((row.completionQualityScore * 100).toFixed(1))
        }));

        let answer = `${headline}\n\n`;
        if (factualSummary.length === 0) {
            answer += 'No matching GR task activity was found in the selected time range.';
        } else {
            answer += factualSummary
                .map(row => `- ${row.repName}: ${row.tasksAssigned} tasks, ${row.completionRate}% completion, ${row.overdueRate}% overdue, ${row.escalationRate}% escalation, ${row.neglectRate}% neglect, completion quality ${row.completionQualityScore ?? 'n/a'}%`)
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
