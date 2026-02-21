import { Request, Response } from "express";
import { assignedTaskService } from "../services/AssignedTaskService";
import { appDatabase } from "../utils/database.util";
import { UsersEntity } from "../entity/Users";
import logger from "../utils/logger.utils";

export class AssignedTaskController {

    // --- Columns ---
    async getColumns(req: Request, res: Response) {
        try {
            const columns = await assignedTaskService.getColumns();
            res.json(columns);
        } catch (error: any) {
            logger.error("Error getting task columns:", error);
            res.status(500).json({ error: error.message });
        }
    }

    async addColumn(req: Request, res: Response) {
        try {
            const column = await assignedTaskService.addColumn(req.body);
            res.status(201).json(column);
        } catch (error: any) {
            logger.error("Error adding task column:", error);
            res.status(500).json({ error: error.message });
        }
    }

    async deleteColumn(req: Request, res: Response) {
        try {
            const { id } = req.params;
            await assignedTaskService.deleteColumn(Number(id));
            res.json({ message: "Column deleted successfully" });
        } catch (error: any) {
            logger.error("Error deleting task column:", error);
            res.status(500).json({ error: error.message });
        }
    }

    // --- Tasks ---
    async getTasks(req: Request, res: Response) {
        try {
            const filter = req.query;
            const tasks = await assignedTaskService.getTasks(filter);
            res.json(tasks);
        } catch (error: any) {
            logger.error("Error getting tasks:", error);
            res.status(500).json({ error: error.message });
        }
    }

    async getWidgetTasks(req: Request, res: Response) {
        try {
            const uid = (req as any).user?.id; // Assuming auth middleware sets req.user (which is supabase UUID)
            if (!uid) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const userRepo = appDatabase.getRepository(UsersEntity);
            const userRecord = await userRepo.findOne({ where: { uid } });
            if (!userRecord) {
                return res.status(404).json({ error: "User not found" });
            }

            const tasks = await assignedTaskService.getWidgetTasks(userRecord.id);
            res.json(tasks);
        } catch (error: any) {
            logger.error("Error getting widget tasks:", error);
            res.status(500).json({ error: error.message });
        }
    }

    async getTaskById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const task = await assignedTaskService.getTaskById(Number(id));
            if (!task) {
                return res.status(404).json({ error: "Task not found" });
            }
            res.json(task);
        } catch (error: any) {
            logger.error("Error getting task:", error);
            res.status(500).json({ error: error.message });
        }
    }

    async createTask(req: Request, res: Response) {
        try {
            const data = req.body;
            const uid = (req as any).user?.id;
            if (uid) {
                const userRepo = appDatabase.getRepository(UsersEntity);
                const userRecord = await userRepo.findOne({ where: { uid } });
                if (userRecord) {
                    data.createdBy = userRecord.id;
                }
            }
            // Overriding taskType to ensure it is always 'Personal' based on user feedback
            data.taskType = 'Personal';

            const task = await assignedTaskService.createTask(data);
            res.status(201).json(task);
        } catch (error: any) {
            logger.error("Error creating task:", error);
            res.status(500).json({ error: error.message });
        }
    }

    async updateTask(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const task = await assignedTaskService.updateTask(Number(id), req.body);
            res.json(task);
        } catch (error: any) {
            logger.error("Error updating task:", error);
            res.status(500).json({ error: error.message });
        }
    }

    async deleteTask(req: Request, res: Response) {
        try {
            const { id } = req.params;
            await assignedTaskService.deleteTask(Number(id));
            res.json({ message: "Task deleted successfully" });
        } catch (error: any) {
            logger.error("Error deleting task:", error);
            res.status(500).json({ error: error.message });
        }
    }

    // --- Updates ---
    async getTaskUpdates(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const updates = await assignedTaskService.getTaskUpdates(Number(id));
            res.json(updates);
        } catch (error: any) {
            logger.error("Error getting task updates:", error);
            res.status(500).json({ error: error.message });
        }
    }

    async addTaskUpdate(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { content } = req.body;
            const uid = (req as any).user?.id;

            if (!uid) {
                return res.status(401).json({ error: "Unauthorized" });
            }
            if (!content) {
                return res.status(400).json({ error: "Content is required" });
            }

            const userRepo = appDatabase.getRepository(UsersEntity);
            const userRecord = await userRepo.findOne({ where: { uid } });
            if (!userRecord) {
                return res.status(404).json({ error: "User not found" });
            }

            const update = await assignedTaskService.addTaskUpdate(Number(id), userRecord.id, content);
            res.status(201).json(update);
        } catch (error: any) {
            logger.error("Error adding task update:", error);
            res.status(500).json({ error: error.message });
        }
    }
}

export const assignedTaskController = new AssignedTaskController();
