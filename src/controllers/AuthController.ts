import { NextFunction, Request, Response } from "express";
import { AuthService } from "../services/AuthService";

export class AuthController {
    async signin(request: Request, response: Response, next: NextFunction) {
        try {
            const authService = new AuthService();
            const { email, password } = request.body;
            return response.send(await authService.signin(email, password));
        } catch (error) {
            next(error);
        }
    }

}
