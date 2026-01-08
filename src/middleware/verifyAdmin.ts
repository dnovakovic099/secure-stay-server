import { NextFunction, Request, Response } from "express";
import { appDatabase } from "../utils/database.util";
import { UsersEntity } from "../entity/Users";

interface CustomRequest extends Request {
  user?: any;
}

/**
 * Middleware to verify that the authenticated user is an admin
 * This should be used after verifySession middleware
 */
const verifyAdmin = async (
  req: CustomRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        status: 401,
      });
    }

    // Check if user is admin in the database
    const usersRepository = appDatabase.getRepository(UsersEntity);
    const user = await usersRepository.findOne({
      where: { uid: userId, deletedAt: null as any },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        status: 404,
      });
    }

    if (user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin privileges required.",
        status: 403,
      });
    }

    next();
  } catch (error) {
    console.error("Error in verifyAdmin middleware:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default verifyAdmin;
