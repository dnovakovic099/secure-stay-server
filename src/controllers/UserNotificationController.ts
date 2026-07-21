import { NextFunction, Request, Response } from "express";
import { UserNotificationService } from "../services/UserNotificationService";

const userUidOf = (req: Request): string | null => {
    const uid = String((req as any).user?.id || "").trim();
    return uid || null;
};

export class UserNotificationController {
    private service = new UserNotificationService();

    getSettings = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const uid = userUidOf(req);
            if (!uid) return res.status(401).json({ status: false, message: "Unauthorized" });
            const data = await this.service.getSettings(uid);
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    updateSettings = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const uid = userUidOf(req);
            if (!uid) return res.status(401).json({ status: false, message: "Unauthorized" });
            const data = await this.service.updateSettings(uid, req.body || {});
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    markSeen = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const uid = userUidOf(req);
            if (!uid) return res.status(401).json({ status: false, message: "Unauthorized" });
            const at = req.body?.at != null ? String(req.body.at) : null;
            const data = await this.service.markSeen(uid, at);
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    /** Recent events + this user's settings (for the top-right bell). */
    listEvents = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const uid = userUidOf(req);
            if (!uid) return res.status(401).json({ status: false, message: "Unauthorized" });
            const since = req.query.since != null ? String(req.query.since) : null;
            const limit = req.query.limit != null ? Number(req.query.limit) : 40;
            const data = await this.service.listEvents(uid, { since, limit });
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };
}
