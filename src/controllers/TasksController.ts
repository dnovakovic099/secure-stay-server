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
            const status = request.query.status; 
            const listingId = request.query.listingId;
            const propertyType = request.query.propertyType as string[];
            const keyword = request.query.keyword;

            const result = await tasksService.getTasks(
                page, 
                limit, 
                fromDate, 
                toDate, 
                status, 
                listingId,
                propertyType,
                keyword
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

    async bulkUpdateTasks(request: any, response: Response) {
        const tasksService = new TasksService();
        try {
            const { ids, updateData } = request.body;
            const userId = request.user.id;

            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return response.status(400).json({
                    status: false,
                    message: "IDs array is required and must not be empty"
                });
            }

            if (!updateData || typeof updateData !== 'object') {
                return response.status(400).json({
                    status: false,
                    message: "Update data is required and must be an object"
                });
            }

            const result = await tasksService.bulkUpdateTasks(ids, updateData, userId);
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