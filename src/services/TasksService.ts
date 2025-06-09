import { appDatabase } from "../utils/database.util";
import { Task } from "../entity/Task";
import { Between} from "typeorm";
import { Listing } from "../entity/Listing";
import { AssigneeEntity } from "../entity/AssigneeInfo";

export class TasksService {
    private taskRepo = appDatabase.getRepository(Task);

    async createTask(data: { listing_id: string, tasks: Array<{ assignee_id: string, task: string, status: string }> }) {
      
        const tasksToCreate = data.tasks.map(taskData => ({
            listing_id: data.listing_id,
            assignee_id: taskData.assignee_id,
            task: taskData.task,
            status: taskData.status || 'Assigned',
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
        status: string = '', 
        listingId: string = '',
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

        if (status) {
            queryOptions.where.status = status;
        }   

        if (listingId) {
            queryOptions.where.listing_id = listingId;
        }

        const [tasks, total] = await this.taskRepo.findAndCount(queryOptions);

        const listing = await appDatabase.getRepository(Listing).find();
        const assignee = await appDatabase.getRepository(AssigneeEntity).find();

        return {
            data: tasks.map((task) => ({
                ...task,
                assignee: assignee.find(assignee => assignee.id === Number(task.assignee_id)) || "",
                listing: listing.find(listing => listing.id === Number(task.listing_id)) || ""
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

        Object.assign(task, {
            ...data,
            ...(data.listing_id && { listing_name: listing_name }),
        });

        return await this.taskRepo.save(task);
    }

    async deleteTask(id: number) {
        return await this.taskRepo.delete(id);
    }
} 