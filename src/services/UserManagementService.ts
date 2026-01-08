import { Request } from "express";
import { appDatabase } from "../utils/database.util";
import { UsersEntity } from "../entity/Users";
import { DepartmentEntity } from "../entity/Department";
import { UserDepartmentEntity } from "../entity/UserDepartment";
import { supabaseAdmin } from "../utils/supabase";
import { Like, In } from "typeorm";

interface UserFilters {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    userType?: string;
}

interface UpdateUserData {
    firstName?: string;
    lastName?: string;
    companyName?: string;
    userType?: string;
}

export class UserManagementService {
    private usersRepository = appDatabase.getRepository(UsersEntity);
    private departmentRepository = appDatabase.getRepository(DepartmentEntity);
    private userDepartmentRepository = appDatabase.getRepository(UserDepartmentEntity);

    /**
     * Get all users with pagination and filters
     */
    async getAllUsers(filters: UserFilters) {
        const page = filters.page || 1;
        const limit = filters.limit || 10;
        const offset = (page - 1) * limit;

        const queryBuilder = this.usersRepository
            .createQueryBuilder("user")
            .where("user.deletedAt IS NULL");

        // Apply search filter
        if (filters.search) {
            queryBuilder.andWhere(
                "(user.firstName LIKE :search OR user.lastName LIKE :search OR user.email LIKE :search)",
                { search: `%${filters.search}%` }
            );
        }

        // Apply status filter
        if (filters.status !== undefined && filters.status !== '') {
            const isActive = filters.status === 'active';
            queryBuilder.andWhere("user.isActive = :isActive", { isActive });
        }

        // Apply userType filter
        if (filters.userType && filters.userType !== '') {
            queryBuilder.andWhere("user.userType = :userType", { userType: filters.userType });
        }

        const [users, total] = await queryBuilder
            .orderBy("user.createdAt", "DESC")
            .skip(offset)
            .take(limit)
            .getManyAndCount();

        // Get departments for each user
        const usersWithDepartments = await Promise.all(
            users.map(async (user) => {
                const userDepartments = await this.userDepartmentRepository.find({
                    where: { userId: user.id },
                    relations: ["department"],
                });
                return {
                    ...user,
                    departments: userDepartments.map((ud) => ud.department).filter(d => d),
                };
            })
        );

        return {
            data: usersWithDepartments,
            total,
            page,
            limit,
        };
    }

    /**
     * Get a single user by ID with departments
     */
    async getUserById(id: number) {
        const user = await this.usersRepository.findOne({
            where: { id, deletedAt: null as any },
        });

        if (!user) {
            return null;
        }

        const userDepartments = await this.userDepartmentRepository.find({
            where: { userId: user.id },
            relations: ["department"],
        });

        return {
            ...user,
            departments: userDepartments.map((ud) => ud.department).filter(d => d),
        };
    }

    /**
     * Get user by UID (Supabase ID)
     */
    async getUserByUid(uid: string) {
        return await this.usersRepository.findOne({
            where: { uid, deletedAt: null as any },
        });
    }


    /**
     * Update user details
     */
    async updateUser(id: number, data: UpdateUserData, updatedBy: string) {
        const user = await this.usersRepository.findOne({
            where: { id, deletedAt: null as any },
        });

        if (!user) {
            return { success: false, message: "User not found" };
        }

        await this.usersRepository.update(id, {
            ...data,
            updatedBy,
            updatedAt: new Date(),
        });

        return { success: true, message: "User updated successfully" };
    }

    /**
     * Toggle user status (enable/disable) using Supabase ban/unban
     */
    async toggleUserStatus(userId: number, isActive: boolean, adminUserId: string) {
        const user = await this.usersRepository.findOne({
            where: { id: userId, deletedAt: null as any },
        });

        if (!user) {
            return { success: false, message: "User not found" };
        }

        try {
            if (isActive) {
                // Enable user - unban in Supabase
                await supabaseAdmin.auth.admin.updateUserById(user.uid, {
                    ban_duration: 'none',
                });

                // Update local database
                await this.usersRepository.update(userId, {
                    isActive: true,
                    reactivatedBy: adminUserId,
                    reactivatedAt: new Date(),
                    updatedBy: adminUserId,
                    updatedAt: new Date(),
                });

                return { success: true, message: "User has been enabled successfully" };
            } else {
                // Disable user - ban in Supabase (permanent until unbanned)
                await supabaseAdmin.auth.admin.updateUserById(user.uid, {
                    ban_duration: '876000h', // ~100 years (effectively permanent)
                });

                // Update local database
                await this.usersRepository.update(userId, {
                    isActive: false,
                    disabledBy: adminUserId,
                    disabledAt: new Date(),
                    updatedBy: adminUserId,
                    updatedAt: new Date(),
                });

                return { success: true, message: "User has been disabled successfully" };
            }
        } catch (error) {
            console.error("Error toggling user status:", error);
            return { success: false, message: "Failed to update user status in Supabase" };
        }
    }

    /**
     * Get all departments
     */
    async getAllDepartments() {
        const departments = await this.departmentRepository.find({
            where: { deletedAt: null as any },
            order: { name: "ASC" },
        });

        return departments;
    }

    /**
     * Create a new department
     */
    async createDepartment(name: string, createdBy: string) {
        // Check if department already exists
        const existing = await this.departmentRepository.findOne({
            where: { name, deletedAt: null as any },
        });

        if (existing) {
            return { success: false, message: "Department already exists", department: existing };
        }

        const department = await this.departmentRepository.save({
            name,
            createdBy,
        });

        return { success: true, message: "Department created successfully", department };
    }

    /**
     * Assign departments to a user (replaces existing assignments)
     */
    async assignDepartments(userId: number, departmentIds: number[], createdBy: string) {
        const user = await this.usersRepository.findOne({
            where: { id: userId, deletedAt: null as any },
        });

        if (!user) {
            return { success: false, message: "User not found" };
        }

        // Delete existing department assignments
        await this.userDepartmentRepository.delete({ userId });

        // Create new assignments
        if (departmentIds.length > 0) {
            const assignments = departmentIds.map((departmentId) => ({
                userId,
                departmentId,
                createdBy,
            }));

            await this.userDepartmentRepository.save(assignments);
        }

        // Update user's updatedBy field
        await this.usersRepository.update(userId, {
            updatedBy: createdBy,
            updatedAt: new Date(),
        });

        return { success: true, message: "Departments assigned successfully" };
    }

    /**
     * Update user type (admin/regular)
     */
    async setUserType(userId: number, userType: string, updatedBy: string) {
        const user = await this.usersRepository.findOne({
            where: { id: userId, deletedAt: null as any },
        });

        if (!user) {
            return { success: false, message: "User not found" };
        }

        if (!['admin', 'regular'].includes(userType)) {
            return { success: false, message: "Invalid user type. Must be 'admin' or 'regular'" };
        }

        await this.usersRepository.update(userId, {
            userType,
            updatedBy,
            updatedAt: new Date(),
        });

        return { success: true, message: `User type updated to ${userType}` };
    }

    /**
     * Update last login timestamp for a user
     */
    async updateLastLogin(uid: string) {
        const user = await this.usersRepository.findOne({
            where: { uid, deletedAt: null as any },
        });

        if (!user) {
            return { success: false, message: "User not found" };
        }

        await this.usersRepository.update(user.id, {
            lastLoginAt: new Date(),
        });

        return { success: true, message: "Last login updated" };
    }
}
