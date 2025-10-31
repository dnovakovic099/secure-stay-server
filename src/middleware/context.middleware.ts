// src/middleware/context.middleware.ts
import { Request, Response, NextFunction } from "express";
import { RequestContext } from "../utils/RequestContext";

export const contextMiddleware = (req: any, res: Response, next: NextFunction) => {
    const user = req.user; // assuming authMiddleware set this
    RequestContext.run({ user }, async () => {
        await next();
    });
};
