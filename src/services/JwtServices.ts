
import jwt from "jsonwebtoken";

export class JwtServices {
    public async sign(payload: Object) {
        return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
    }

    public async verify(token: string) {
        return jwt.verify(token, process.env.JWT_SECRET);
    };
}
