import { Request, Response } from "express";
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
}
