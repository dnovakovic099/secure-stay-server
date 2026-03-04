import { Router } from 'express';
import { getLogs, getStats, getLogById, getLogsByTask, submitFeedback, getFeedbackStats } from '../controllers/AIEscalationLogController';

const router = Router();

/**
 * AI Escalation Manager Routes
 * 
 * GET /ai/logs - Get paginated AI decision logs with filters
 * GET /ai/logs/stats - Get AI decision statistics
 * GET /ai/logs/feedback-stats - Get feedback statistics for AI improvement
 * GET /ai/logs/:id - Get single log entry
 * GET /ai/logs/task/:taskId - Get all logs for a specific task
 * POST /ai/logs/:id/feedback - Submit feedback on an AI decision
 */

router.get('/logs', getLogs);
router.get('/logs/stats', getStats);
router.get('/logs/feedback-stats', getFeedbackStats);
router.get('/logs/:id', getLogById);
router.get('/logs/task/:taskId', getLogsByTask);
router.post('/logs/:id/feedback', submitFeedback);

export default router;
