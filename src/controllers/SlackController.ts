
import { Request, Response, NextFunction } from "express";
import { getSlackUsers } from "../utils/getSlackUsers";

export class SlackController {
    async getUsers(req: Request, res: Response, next: NextFunction) {
        try {
            const users = await getSlackUsers();
            res.json(users);
        } catch (error) {
            next(error);
        }
    }
}
