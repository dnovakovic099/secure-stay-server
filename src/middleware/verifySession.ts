import { NextFunction, Request, Response } from "express";
import { appDatabase } from "../utils/database.util";
import { UserApiKeyEntity } from "../entity/UserApiKey";
import { supabase } from "../utils/supabase";


interface CustomRequest extends Request {
  user?: any;
}

const verifySession = async (
  req: CustomRequest,
  res: Response,
  next: NextFunction
) => {
  const accessToken = req.headers.authorization?.split(" ")[1];
  const apiKeyHeader = req.headers['x-api-key'];

  if (!accessToken) {

    try {
      // check for apiKey authentication

      // Handle the case where apiKey could be an array of strings
      const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
      if (!apiKey) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const userApiKeyRepo = appDatabase.getRepository(UserApiKeyEntity);
      const user = await userApiKeyRepo.findOne({ where: { apiKey: apiKey, isActive: true } });

      if (!user) {
        return res.status(403).json({ message: 'Invalid API key' });
      }

      req.user = {
        id: user.userId,
      };
      next();
    } catch (error) {
      return res.status(500).json({ message: "Internal server error" });
    }
  } else {
    try {
      const { data, error } = await supabase.auth.getUser(accessToken);

      if (error) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
          status: 401,
        });
      }

      req.user = data.user;
      next();
    } catch (error) {
      return res.status(500).json({ message: "Internal server error" });
    }
  }

};

export default verifySession;
