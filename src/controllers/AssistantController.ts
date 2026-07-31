import { NextFunction, Request, Response } from "express";
import { AssistantService, AssistantEvent } from "../services/assistant/AssistantService";
import { resolveViewer } from "../services/assistant/viewer";

interface CustomRequest extends Request {
    user?: any;
}

export class AssistantController {
    private service = new AssistantService();

    /**
     * Streaming answer over SSE.
     *
     * POST rather than GET (so EventSource is not an option client-side) because
     * the question can be long and must not end up in access logs or browser
     * history. The dashboard reads this with fetch + ReadableStream.
     */
    ask = async (req: CustomRequest, res: Response) => {
        let viewer;
        try {
            viewer = await resolveViewer(req.user);
        } catch {
            // Identity is the security boundary — if we cannot establish it, we
            // answer nothing. Reported as JSON since the stream hasn't started.
            return res
                .status(500)
                .json({ status: false, message: "Could not establish your identity." });
        }

        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        // Nginx buffers proxied responses by default, which would defeat streaming.
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();

        let closed = false;
        req.on("close", () => {
            closed = true;
        });

        const send = (event: AssistantEvent) => {
            if (closed || res.writableEnded) return;
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        // Keep intermediaries from timing out the connection during long tool rounds.
        const heartbeat = setInterval(() => {
            if (!closed && !res.writableEnded) res.write(": ping\n\n");
        }, 15000);

        try {
            await this.service.ask(
                viewer,
                {
                    question: String(req.body?.question ?? ""),
                    conversationId: req.body?.conversationId ? Number(req.body.conversationId) : null,
                },
                send
            );
        } catch (error: any) {
            send({ type: "error", message: "The assistant failed unexpectedly." });
        } finally {
            clearInterval(heartbeat);
            if (!res.writableEnded) res.end();
        }
    };

    listConversations = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const viewer = await resolveViewer(req.user);
            const data = await this.service.listConversations(viewer);
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    getMessages = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const viewer = await resolveViewer(req.user);
            const data = await this.service.getMessages(viewer, Number(req.params.id));
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    archiveConversation = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const viewer = await resolveViewer(req.user);
            await this.service.archiveConversation(viewer, Number(req.params.id));
            return res.status(200).json({ status: true });
        } catch (error) {
            return next(error);
        }
    };

    getPreferences = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const viewer = await resolveViewer(req.user);
            const prefs = await this.service.getPreferences(viewer);
            // `enabled: false` is what makes the widget not render at all, so the
            // rollout gate is what the frontend keys off.
            return res.status(200).json({
                status: true,
                data: { ...prefs, enabled: AssistantService.isEnabledFor(viewer) },
            });
        } catch (error) {
            return next(error);
        }
    };

    updatePreferences = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const viewer = await resolveViewer(req.user);
            const data = await this.service.setPreferences(viewer, Boolean(req.body?.isHidden));
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };
}
