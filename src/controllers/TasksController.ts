import { Request, Response } from "express";
import { TasksService } from "../services/TasksService";

export class TasksController {
    async getTasks(request: Request, response: Response) {
        const tasksService = new TasksService();
        try {   
            const page = parseInt(request.query.page as string) || 1;
            const limit = parseInt(request.query.limit as string) || 10;
            const fromDate = request.query.fromDate as string || '';
            const toDate = request.query.toDate as string || '';
            const status = request.query.status as string || ''; 
            const listingId = request.query.listingId;

            const result = await tasksService.getTasks(
                page, 
                limit, 
                fromDate, 
                toDate, 
                status, 
                listingId
            );
            
            return response.send({
                status: true,
                ...result
            });
        } catch (error) {
            return response.send({
                status: false,
                message: error.message
            });
        }
    }

    async createTask(request: any, response: Response) {
        const tasksService = new TasksService();
        try {
            const result = await tasksService.createTask(request.body, request.user.id);
            return response.status(201).json({
                status: true,
                data: result
            });
        } catch (error) {
            return response.status(400).json({
                status: false,
                message: error.message
            });
        }
    }

    async updateTask(request: any, response: Response) {
        const tasksService = new TasksService();
        try {
            const id = parseInt(request.params.id);
            const userId = request.user.id;

            const result = await tasksService.updateTask(id, request.body, userId);
            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            return response.status(400).json({
                status: false,
                message: error.message
            });
        }
    }

    async deleteTask(request: any, response: Response) {
        const tasksService = new TasksService();
        try {
            const { id } = request.params;
            const userId = request.user.id;
            await tasksService.deleteTask(Number(id), userId);
            return response.send({
                status: true,
                message: "Task deleted successfully"
            });
        } catch (error) {
            return response.send({
                status: false,
                message: error.message
            });
        }
    }

    async addToPostStay(request: any, response: Response) {
        try {
            const { id } = request.params;
            const tasksService = new TasksService();
            const result = await tasksService.addToPostStay(Number(id), request.user.id);
            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            return response.status(400).json({
                status: false,
                message: error.message
            });
        }
    }
} 