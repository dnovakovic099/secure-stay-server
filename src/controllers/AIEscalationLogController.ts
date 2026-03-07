import { Request, Response } from 'express';
import { appDatabase } from '../utils/database.util';
import { AIEscalationLog } from '../entity/AIEscalationLog';
import { Between, In, Like } from 'typeorm';
import logger from '../utils/logger.utils';

const logRepo = appDatabase.getRepository(AIEscalationLog);

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
        const { feedback, rating } = req.body;
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
