import { createClient } from '@supabase/supabase-js';
import { NextFunction, Request, Response } from 'express';

const supabaseUrl = process?.env.SUPABASE_URL;
const supabaseKey = process?.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

interface CustomRequest extends Request {
    user?: any;
}


const verifySession = async (req: CustomRequest, res: Response, next: NextFunction) => {
    const accessToken = req.headers.authorization?.split(' ')[1];


    if (!accessToken) {
        return res.status(401).json({ message: 'Unauthorized - No access token provided' });
    }

    try {
        const { data, error } = await supabase.auth.getUser(accessToken);

        if (error) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
                status: 401
            });
        }

        req.user = data.user;
        next();

    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export default verifySession;
