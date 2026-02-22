import { appDatabase } from "../utils/database.util";
import { AssignedTask } from "../entity/AssignedTask";
import { TaskColumn } from "../entity/TaskColumn";
import { AssignedTaskUpdate } from "../entity/AssignedTaskUpdate";
import moment from "moment";

export class AssignedTaskService {
    private assignedTaskRepo = appDatabase.getRepository(AssignedTask);
    private taskColumnRepo = appDatabase.getRepository(TaskColumn);
    private taskUpdateRepo = appDatabase.getRepository(AssignedTaskUpdate);

    // --- Columns Management ---

    async getColumns() {
        return await this.taskColumnRepo.find({ order: { createdAt: 'ASC' } });
    }

    async addColumn(data: Partial<TaskColumn>) {
        const column = this.taskColumnRepo.create(data);
        return await this.taskColumnRepo.save(column);
    }

    async deleteColumn(columnId: number) {
        // Prevent deleting default columns if necessary, but trusting the controller to check
        await this.taskColumnRepo.delete(columnId);
        return { success: true };
    }

    // --- Task Management ---

    async getTasks(filters: any = {}) {
        const query = this.assignedTaskRepo.createQueryBuilder("task")
            .leftJoinAndSelect("task.assignee", "assignee")
            .leftJoinAndSelect("task.creator", "creator")
            .orderBy("task.dueDate", "ASC");

        // Example filters implementation
        if (filters.search) {
            query.andWhere("task.title LIKE :search", { search: `%${filters.search}%` });
        }
        if (filters.assigneeId) {
            query.andWhere("task.assigneeId = :assigneeId", { assigneeId: filters.assigneeId });
        }
        if (filters.status) {
            query.andWhere("task.status = :status", { status: filters.status });
        }
        if (filters.taskType) {
            query.andWhere("task.taskType = :taskType", { taskType: filters.taskType });
        }
        if (filters.startDate && filters.endDate) {
            query.andWhere("task.dueDate >= :startDate AND task.dueDate <= :endDate", {
                startDate: filters.startDate,
                endDate: filters.endDate
            });
        }

        return await query.getMany();
    }

    async getTaskById(taskId: number) {
        return await this.assignedTaskRepo.findOne({
            where: { id: taskId },
            relations: ["assignee", "creator"]
        });
    }

    async getWidgetTasks(userId: number) {
        // Sort specifically with Personal first, then by dueDate
        const query = this.assignedTaskRepo.createQueryBuilder("task")
            .leftJoinAndSelect("task.assignee", "assignee")
            .where("task.assigneeId = :userId", { userId })
            .andWhere("task.status != :status", { status: 'Completed' })
            .orderBy("CASE WHEN task.taskType = 'Personal' THEN 1 ELSE 2 END", "ASC")
            .addOrderBy("task.dueDate", "ASC");

        return await query.getMany();
    }

    async createTask(data: Partial<AssignedTask>) {
        const task = this.assignedTaskRepo.create(data);
        return await this.assignedTaskRepo.save(task);
    }

    async updateTask(taskId: number, data: Partial<AssignedTask>) {
        const task = await this.assignedTaskRepo.findOne({ where: { id: taskId } });
        if (!task) throw new Error("Task not found");

        let updatedData = { ...data };

        // Recurring tasks logic: handle Completion
        if (updatedData.status === 'Completed' && task.isRecurring && task.recurringPattern) {
            let nextDueDate: Date;
            const pattern = task.recurringPattern;
            const refDate = task.dueDate ? moment(task.dueDate) : moment();

            if (pattern.type === 'daily') {
                nextDueDate = refDate.add(1, 'days').toDate();
            } else if (pattern.type === 'weekly') {
                if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
                    const targetDays = pattern.daysOfWeek;
                    let nextDate = refDate.clone().add(1, 'days');
                    for (let i = 0; i < 8; i++) {
                        if (targetDays.includes(nextDate.format('ddd'))) {
                            break;
                        }
                        nextDate.add(1, 'days');
                    }
                    nextDueDate = nextDate.toDate();
                } else {
                    nextDueDate = refDate.add(1, 'weeks').toDate();
                }
            } else if (pattern.type === 'monthly') {
                if (pattern.dayOfMonth) {
                    let nextDate = refDate.clone().add(1, 'months').date(pattern.dayOfMonth);
                    nextDueDate = nextDate.toDate();
                } else {
                    nextDueDate = refDate.add(1, 'months').toDate();
                }
            } else if (pattern.type === 'yearly') {
                if (pattern.monthOfYear && pattern.dayOfMonth) {
                    let nextDate = refDate.clone().add(1, 'years').month(pattern.monthOfYear).date(pattern.dayOfMonth);
                    nextDueDate = nextDate.toDate();
                } else {
                    nextDueDate = refDate.add(1, 'years').toDate();
                }
            } else if (pattern.type === 'periodically') {
                const days = pattern.daysAfterCompletion || 1;
                nextDueDate = moment().add(days, 'days').toDate();
            } else {
                nextDueDate = refDate.add(1, 'days').toDate(); // fallback
            }

            // Create the next occurrence
            const nextTask = this.assignedTaskRepo.create({
                title: task.title,
                description: task.description,
                status: 'Pending',
                taskType: task.taskType,
                assigneeId: task.assigneeId,
                dueDate: nextDueDate,
                isRecurring: true,
                recurringPattern: task.recurringPattern,
                customColumnValues: task.customColumnValues,
                createdBy: task.createdBy
            });
            await this.assignedTaskRepo.save(nextTask);

            // Mark the current one as completed and no longer recurring
            updatedData.isRecurring = false;
        }

        Object.assign(task, updatedData);
        return await this.assignedTaskRepo.save(task);
    }

    async deleteTask(taskId: number) {
        return await this.assignedTaskRepo.delete(taskId);
    }

    // --- Task Updates/Comments ---

    async getTaskUpdates(taskId: number) {
        return await this.taskUpdateRepo.find({
            where: { taskId },
            relations: ["user"],
            order: { createdAt: 'DESC' }
        });
    }

    async addTaskUpdate(taskId: number, userId: number, content: string) {
        const update = this.taskUpdateRepo.create({ taskId, userId, content });
        return await this.taskUpdateRepo.save(update);
    }
}

export const assignedTaskService = new AssignedTaskService();
