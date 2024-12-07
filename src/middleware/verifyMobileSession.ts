import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { JwtServices } from "../services/JwtServices";

interface CustomRequest extends Request {
    user?: any;
}

interface TokenPayload extends JwtPayload {
    userId: string;
    email: string;
    fullname: string;
}

const verifyMobileSession = async (
    req: CustomRequest,
    res: Response,
    next: NextFunction
) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        console.warn(`{Api:${req.url}, Message:"Authorization header missing"}`);
        return res.status(401).json({ message: "Authorization header missing" });;
    }

    const parts = authHeader.split(' ');

    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        console.warn(`{Api:${req.url}, Message:"Invalid Authorization header format"}`);
        return res.status(401).json({ message: "Invalid Authorization header format" });
    }

    const token = parts[1];

    try {
        const jwtServices = new JwtServices();
        const { userId, email, name } = await jwtServices.verify(token) as TokenPayload;
        req.user = { userId, email, name };
        next();
    } catch (error) {
        console.error(`{Api:${req.url}, Error:${error.message}, Stack:${error.stack} }`);
        return res.status(401).json({ message: "Unauthorized" });
    }

};

export default verifyMobileSession;
