import { NextFunction, Request, Response } from "express";
import { UserManagementService } from "../services/UserManagementService";

interface CustomRequest extends Request {
    user?: any;
}

export class UserManagementController {
    private userManagementService = new UserManagementService();

    /**
     * GET /user-management
     * Get all users with pagination and filters
     */
    getAllUsers = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const filters = {
                page: Number(req.query.page) || 1,
                limit: Number(req.query.limit) || 10,
                search: req.query.search as string,
                status: req.query.status as string,
                userType: req.query.userType as string,
            };

            const result = await this.userManagementService.getAllUsers(filters);
            return res.status(200).json(result);
        } catch (error) {
            console.error("Error fetching users:", error);
            return next(error);
        }
    };

    /**
     * GET /user-management/:id
     * Get a single user by ID
     */
    getUserById = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const userId = Number(req.params.id);

            if (!userId || isNaN(userId)) {
                return res.status(400).json({ success: false, message: "Invalid user ID" });
            }

            const user = await this.userManagementService.getUserById(userId);

            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            return res.status(200).json({ success: true, data: user });
        } catch (error) {
            console.error("Error fetching user:", error);
            return next(error);
        }
    };

    /**
     * PUT /user-management/:id
     * Update user details
     */
    updateUser = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const userId = Number(req.params.id);
            const updatedBy = req.user?.id;

            if (!userId || isNaN(userId)) {
                return res.status(400).json({ success: false, message: "Invalid user ID" });
            }

            const { firstName, lastName, companyName, userType } = req.body;

            const result = await this.userManagementService.updateUser(
                userId,
                { firstName, lastName, companyName, userType },
                updatedBy
            );

            if (!result.success) {
                return res.status(404).json(result);
            }

            return res.status(200).json(result);
        } catch (error) {
            console.error("Error updating user:", error);
            return next(error);
        }
    };

    /**
     * PATCH /user-management/:id/toggle-status
     * Toggle user active status (ban/unban in Supabase)
     */
    toggleUserStatus = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const userId = Number(req.params.id);
            const adminUserId = req.user?.id;
            const { isActive } = req.body;

            if (!userId || isNaN(userId)) {
                return res.status(400).json({ success: false, message: "Invalid user ID" });
            }

            if (typeof isActive !== 'boolean') {
                return res.status(400).json({ success: false, message: "isActive must be a boolean" });
            }

            const result = await this.userManagementService.toggleUserStatus(userId, isActive, adminUserId);

            if (!result.success) {
                return res.status(400).json(result);
            }

            return res.status(200).json(result);
        } catch (error) {
            console.error("Error toggling user status:", error);
            return next(error);
        }
    };

    /**
     * GET /user-management/departments
     * Get all departments
     */
    getAllDepartments = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const departments = await this.userManagementService.getAllDepartments();
            return res.status(200).json({ success: true, data: departments });
        } catch (error) {
            console.error("Error fetching departments:", error);
            return next(error);
        }
    };

    /**
     * POST /user-management/departments
     * Create a new department
     */
    createDepartment = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { name } = req.body;
            const createdBy = req.user?.id;

            if (!name || typeof name !== 'string' || name.trim() === '') {
                return res.status(400).json({ success: false, message: "Department name is required" });
            }

            const result = await this.userManagementService.createDepartment(name.trim(), createdBy);

            if (!result.success && result.message === "Department already exists") {
                return res.status(409).json(result);
            }

            return res.status(201).json(result);
        } catch (error) {
            console.error("Error creating department:", error);
            return next(error);
        }
    };

    /**
     * PUT /user-management/:id/departments
     * Assign departments to a user
     */
    assignDepartments = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const userId = Number(req.params.id);
            const createdBy = req.user?.id;
            const { departmentIds } = req.body;

            if (!userId || isNaN(userId)) {
                return res.status(400).json({ success: false, message: "Invalid user ID" });
            }

            if (!Array.isArray(departmentIds)) {
                return res.status(400).json({ success: false, message: "departmentIds must be an array" });
            }

            const result = await this.userManagementService.assignDepartments(userId, departmentIds, createdBy);

            if (!result.success) {
                return res.status(404).json(result);
            }

            return res.status(200).json(result);
        } catch (error) {
            console.error("Error assigning departments:", error);
            return next(error);
        }
    };

    /**
     * PATCH /user-management/:id/user-type
     * Update user type (admin/regular)
     */
    setUserType = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const userId = Number(req.params.id);
            const updatedBy = req.user?.id;
            const { userType } = req.body;

            if (!userId || isNaN(userId)) {
                return res.status(400).json({ success: false, message: "Invalid user ID" });
            }

            if (!userType || typeof userType !== 'string') {
                return res.status(400).json({ success: false, message: "userType is required" });
            }

            const result = await this.userManagementService.setUserType(userId, userType, updatedBy);

            if (!result.success) {
                return res.status(400).json(result);
            }

            return res.status(200).json(result);
        } catch (error) {
            console.error("Error updating user type:", error);
            return next(error);
        }
    };

    /**
     * POST /user-management/update-last-login
     * Update last login timestamp for the current user
     */
    updateLastLogin = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const uid = req.user?.id;

            if (!uid) {
                return res.status(400).json({ success: false, message: "User ID not found" });
            }

            const result = await this.userManagementService.updateLastLogin(uid);

            return res.status(200).json(result);
        } catch (error) {
            console.error("Error updating last login:", error);
            return next(error);
        }
    };
}
