import { NextFunction, Request, Response } from "express";
import { CategoryService } from "../services/CategoryService";

interface CustomRequest extends Request {
    user?: any;
}

export class CategoryController {
    async createCategory(request: CustomRequest, response: Response) {
        const categoryService = new CategoryService();;
        return response.send(await categoryService.createCategory(request));
    }

    async getAllCategories(request: CustomRequest, response: Response) {
        const categoryService = new CategoryService();
        return response.send(await categoryService.getAllCategories());
    }

    async updateCategory(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const categoryService = new CategoryService();
            return response.send(await categoryService.updateCategory(Number(request.params.id), request.body));
        } catch (error) {
            return next(error);
        }
    }

    async reorderCategories(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const categoryService = new CategoryService();
            return response.send(await categoryService.reorderCategories(request.body));
        } catch (error) {
            return next(error);
        }
    }

    async getCategoryUsage(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const categoryService = new CategoryService();
            return response.send(await categoryService.getCategoryUsage(Number(request.params.id)));
        } catch (error) {
            return next(error);
        }
    }

    async deleteCategory(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const categoryService = new CategoryService();
            return response.send(await categoryService.deleteCategory(Number(request.params.id), request.body));
        } catch (error) {
            return next(error);
        }
    }
}
