import { Request, Response } from 'express';
import { ThreadService } from '../services/ThreadService';
import logger from '../utils/logger.utils';

export class ThreadController {
    private threadService = new ThreadService();

    /**
     * GET /webhook/zapier/events/:id/thread
     * Get all thread messages for a GR Task
     */
    getThreadMessages = async (req: Request, res: Response) => {
        try {
            const grTaskId = parseInt(req.params.id);

            if (isNaN(grTaskId)) {
                return res.status(400).json({ error: 'Invalid task ID' });
            }

            const messages = await this.threadService.getThreadMessages(grTaskId);
            return res.status(200).json(messages);
        } catch (error) {
            logger.error(`[ThreadController][getThreadMessages] Error: ${error}`);
            return res.status(500).json({ error: 'Failed to fetch thread messages' });
        }
    };

    /**
     * POST /webhook/zapier/events/:id/thread
     * Post a new message to the thread
     */
    postThreadMessage = async (req: Request, res: Response) => {
        try {
            const grTaskId = parseInt(req.params.id);
            const { content } = req.body;

            if (isNaN(grTaskId)) {
                return res.status(400).json({ error: 'Invalid task ID' });
            }

            if (!content || !content.trim()) {
                return res.status(400).json({ error: 'Content is required' });
            }

            // Get user info from request (set by auth middleware)
            const user = (req as any).user;
            const userName = user?.user_metadata?.full_name || user?.email || 'SecureStay User';

            const message = await this.threadService.postMessage(
                grTaskId,
                content.trim(),
                userName
            );

            return res.status(201).json(message);
        } catch (error) {
            logger.error(`[ThreadController][postThreadMessage] Error: ${error}`);
            return res.status(500).json({ error: 'Failed to post message' });
        }
    };
}
