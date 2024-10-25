import { appDatabase } from "../utils/database.util";
import { CategoryEntity } from "../entity/Category";
import { Request } from "express";

export class CategoryService {
    private categoryRepo = appDatabase.getRepository(CategoryEntity);

    async createCategory(request: Request) {
        const { categoryName } = request.body;

        const newCategory = new CategoryEntity();
        newCategory.categoryName = categoryName;

        const category = await this.categoryRepo.save(newCategory);
        return category;
    }

    async getAllCategories() {
        return await this.categoryRepo.find();
    }

}
