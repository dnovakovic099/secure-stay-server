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
            taskId
        } = req.query;

        const where: any = {};

        if (decision) where.decision = decision;
        if (aiMode) where.aiMode = aiMode;
        if (slackChannel) where.slackChannel = slackChannel;
        if (eventType) where.eventType = eventType;
        if (executed !== undefined) where.executed = executed === 'true';
        if (taskId) where.taskId = Number(taskId);

        if (startDate || endDate) {
            const start = startDate ? new Date(startDate as string) : new Date('2020-01-01');
            const end = endDate ? new Date(endDate as string) : new Date();
            where.createdAt = Between(start, end);
        }

        const [logs, total] = await logRepo.findAndCount({
            where,
            order: { createdAt: 'DESC' },
            skip: (Number(page) - 1) * Number(limit),
            take: Number(limit)
        });

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
