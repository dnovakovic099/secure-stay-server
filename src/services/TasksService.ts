import { appDatabase } from "../utils/database.util";
import { Task } from "../entity/Task";
import { Between, In, ILike} from "typeorm";
import { Listing } from "../entity/Listing";
import { AssigneeEntity } from "../entity/AssigneeInfo";
import { UsersEntity } from "../entity/Users";
import CustomErrorHandler from "../middleware/customError.middleware";
import { format } from "date-fns";
import { ListingService } from "./ListingService";

export class TasksService {
    private taskRepo = appDatabase.getRepository(Task);

    async createTask(data: { listing_id: string, tasks: Array<{ assignee_id: string, task: string, status: string }> }, userId: string) {
        const tasksToCreate = data.tasks.map(taskData => ({
            listing_id: data.listing_id,
            assignee_id: taskData.assignee_id,
            task: taskData.task,
            status: taskData.status || 'Assigned',
            created_by: userId
        }));

        const newTasks = this.taskRepo.create(tasksToCreate);
        const savedTasks = await this.taskRepo.save(newTasks);
        return savedTasks;
    }

    async getTasks(
        page: number = 1, 
        limit: number = 10, 
        fromDate: string = '', 
        toDate: string = '', 
        status: any, 
        listingId: any,
        propertyType: any,
        keyword: any
    ) {
        const queryOptions: any = {
            where: {},
            order: { 
                created_at: 'DESC',
                status: "ASC"
            },
            skip: (page - 1) * limit,
            take: limit
        };

        if (fromDate && toDate) {
            const startDate = new Date(fromDate);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(toDate);

            endDate.setDate(endDate.getDate() + 1);
            endDate.setUTCHours(0, 0, 0, 0);

            queryOptions.where = {
                created_at: Between(
                    startDate,
                    endDate
                )
            };
        }

        if (status && Array.isArray(status)) {
            queryOptions.where.status = In(status);
        }   

        if (listingId && Array.isArray(listingId)) {
            queryOptions.where.listing_id = In(listingId);
        }

        if (propertyType && Array.isArray(propertyType)) {
            const listingService = new ListingService();
            const listingIds = (await listingService.getListingsByTagIds(propertyType)).map(l => l.id);
            queryOptions.where.listing_id = In(listingIds);
        }

        const where = keyword
        ? [
            { ...queryOptions.where, task: ILike(`%${keyword}%`) },
        ]
        : queryOptions.where;

        queryOptions.where = where;

        const [tasks, total] = await this.taskRepo.findAndCount(queryOptions);

        const listing = await appDatabase.getRepository(Listing).find();
        const assignee = await appDatabase.getRepository(AssigneeEntity).find();
        const user = await appDatabase.getRepository(UsersEntity).find();

        return {
            data: tasks.map((task) => ({
                ...task,
                assignee: assignee.find(assignee => assignee.id === Number(task.assignee_id)) || "",
                listing: listing.find(listing => listing.id === Number(task.listing_id)) || "",
                updated_by: user.find(user => user?.uid === task?.updated_by)?.firstName || "",
                completed_by: user.find(user => user?.uid === task?.completed_by)?.firstName || "",
                created_by: user.find(user => user?.uid === task?.created_by)?.firstName || "",
                created_at: format(task.created_at, 'yyyy-MM-dd'),
                updated_at: task.updated_at ? format(task.updated_at, 'yyyy-MM-dd') : "",
                completed_at: task.completed_at ? format(task.completed_at, 'yyyy-MM-dd') : "",
            })),
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async updateTask(id: number, data: Partial<Task>, userId: string) {
        const task = await this.taskRepo.findOne({ 
            where: { id }
        });

        if (!task) {
            throw new Error('Task not found');
        }

        let listing_name = '';
        if (data.listing_id) {
            listing_name = (await appDatabase.getRepository(Listing).findOne({ where: { id: Number(data.listing_id) } }))?.internalListingName || "";
        }

        // If status is being updated to 'Completed', set completed_at and completed_by
        if (data.status === 'Completed' && task.status !== 'Completed') {
            data.completed_at = new Date();
            data.completed_by = userId;
        } else if (data.status !== 'Completed' && task.status === 'Completed') {
            data.completed_at = null;
            data.completed_by = null;
        }

        Object.assign(task, {
            ...data,
            ...(data.listing_id && { listing_name: listing_name }),
            updated_by: userId
        });

        return await this.taskRepo.save(task);
    }

    async deleteTask(id: number, userId: string) {
        await this.taskRepo.update(id, {
            deletedAt: new Date(),
            deleted_by: userId,
        });
    }

    async addToPostStay(id: number, userId: string) {
        const task = await this.taskRepo.findOne({ where: { id } });
        if (!task) {
            throw CustomErrorHandler.notFound('Task not found');
        }

        task.add_to_post_stay = !task.add_to_post_stay;
        task.updated_by = userId;

        return await this.taskRepo.save(task);
    }

    async bulkUpdateTasks(ids: number[], updateData: Partial<Task>, userId: string) {
        try {
            const existingTasks = await this.taskRepo.find({
                where: { id: In(ids) }
            });

            if (existingTasks.length !== ids.length) {
                const foundIds = existingTasks.map(t => t.id);
                const missingIds = ids.filter(id => !foundIds.includes(id));
                throw CustomErrorHandler.notFound(`Tasks with IDs ${missingIds.join(', ')} not found`);
            }

            const updatePromises = existingTasks.map(async (task) => {
                // Handle status transition and completion fields coherently per task
                if (updateData.status !== undefined) {
                    const targetStatus = updateData.status;
                    const wasCompleted = task.status === 'Completed';
                    const willBeCompleted = targetStatus === 'Completed';

                    if (!wasCompleted && willBeCompleted) {
                        task.completed_at = new Date();
                        task.completed_by = userId;
                    } else if (wasCompleted && !willBeCompleted) {
                        task.completed_at = null;
                        task.completed_by = null;
                    }

                    task.status = targetStatus;
                }

                if (updateData.listing_id !== undefined) {
                    task.listing_id = updateData.listing_id as string;
                }

                if (updateData.assignee_id !== undefined) {
                    task.assignee_id = updateData.assignee_id as string;
                }

                if (updateData.task !== undefined) {
                    task.task = updateData.task as string;
                }

                if (updateData.add_to_post_stay !== undefined) {
                    task.add_to_post_stay = !!updateData.add_to_post_stay;
                }

                task.updated_by = userId;
                return this.taskRepo.save(task);
            });

            const updatedTasks = await Promise.all(updatePromises);
            return {
                success: true,
                updatedCount: updatedTasks.length,
                message: `Successfully updated ${updatedTasks.length} tasks`
            };
        } catch (error: any) {
            throw error;
        }
    }
} 