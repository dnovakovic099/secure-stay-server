import { Request, Response } from "express";
import { ThreadService } from "../services/ThreadService";

export class ThreadController {
    private threadService = new ThreadService();

    /**
     * GET /gr-tasks/:id/thread
     * Get all thread messages for a GR Task
     */
    async getThreadMessages(request: Request, response: Response) {
        try {
            const grTaskId = parseInt(request.params.id);
            
            // These would normally come from the GR Task record
            // For now, expect them as query params or from request body
            const slackChannelId = request.query.slackChannelId as string || null;
            const slackThreadTs = request.query.slackThreadTs as string || null;

            if (isNaN(grTaskId)) {
                return response.status(400).json({ error: 'Invalid task ID' });
            }

            const messages = await this.threadService.getThreadMessages(
                grTaskId,
                slackChannelId,
                slackThreadTs
            );

            response.json(messages);
        } catch (error) {
            console.error('Error fetching thread messages:', error);
            response.status(500).json({ error: 'Failed to fetch thread messages' });
        }
    }

    /**
     * POST /gr-tasks/:id/thread
     * Post a new message to the thread
     */
    async postThreadMessage(request: Request, response: Response) {
        try {
            const grTaskId = parseInt(request.params.id);
            const { content, userName, userAvatar, slackChannelId, slackThreadTs } = request.body;

            if (isNaN(grTaskId)) {
                return response.status(400).json({ error: 'Invalid task ID' });
            }

            if (!content || !content.trim()) {
                return response.status(400).json({ error: 'Content is required' });
            }

            // Default userName if not provided
            const finalUserName = userName || 'SecureStay User';

            const message = await this.threadService.postMessage(
                grTaskId,
                slackChannelId || null,
                slackThreadTs || null,
                content.trim(),
                finalUserName,
                userAvatar
            );

            response.status(201).json(message);
        } catch (error) {
            console.error('Error posting thread message:', error);
            response.status(500).json({ error: 'Failed to post message' });
        }
    }
}
