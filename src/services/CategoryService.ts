import { appDatabase } from "../utils/database.util";
import { CategoryEntity } from "../entity/Category";
import { Request } from "express";
import { ExpenseEntity } from "../entity/Expense";
import CustomErrorHandler from "../middleware/customError.middleware";

export class CategoryService {
    private categoryRepo = appDatabase.getRepository(CategoryEntity);
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);

    private parseCategoryIds(value?: string | null): string[] {
        if (!value) return [];
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed.map((item) => String(item));
        } catch {
            return String(value).replace(/[\[\]"]/g, '').split(',').map((item) => item.trim()).filter(Boolean);
        }
        return [];
    }

    private async findByPublicId(id: number) {
        return await this.categoryRepo.findOne({ where: { hostawayId: id } }) ||
            await this.categoryRepo.findOne({ where: { id } });
    }

    private async createInternalCategory(categoryName: string) {
        const trimmedName = String(categoryName || '').trim();
        if (!trimmedName) throw CustomErrorHandler.validationError('Category name is required.');

        const category = new CategoryEntity();
        category.categoryName = trimmedName;
        const maxOrder = await this.categoryRepo
            .createQueryBuilder("category")
            .select("MAX(category.displayOrder)", "maxOrder")
            .getRawOne();
        category.displayOrder = Number(maxOrder?.maxOrder || 0) + 1;
        const savedCategory = await this.categoryRepo.save(category);

        if (!savedCategory.hostawayId) {
            savedCategory.hostawayId = savedCategory.id;
            return await this.categoryRepo.save(savedCategory);
        }

        return savedCategory;
    }

    async createCategory(request: Request) {
        const { categoryName } = request.body;
        return await this.createInternalCategory(categoryName);
    }

    async getAllCategories() {
        return await this.categoryRepo
            .createQueryBuilder("category")
            .select([
                "category.hostawayId AS id",
                "category.id AS categoryId",
                "category.categoryName AS categoryName",
                "category.displayOrder AS displayOrder"
            ])
            .orderBy("category.displayOrder IS NULL", "ASC")
            .addOrderBy("category.displayOrder", "ASC")
            .addOrderBy("category.categoryName", "ASC")
            .getRawMany();
    }

    async updateCategory(categoryId: number, body: { categoryName?: string }) {
        const category = await this.findByPublicId(categoryId);
        if (!category) throw CustomErrorHandler.notFound('Category not found.');

        const categoryName = String(body.categoryName || '').trim();
        if (!categoryName) throw CustomErrorHandler.validationError('Category name is required.');

        category.categoryName = categoryName;
        return await this.categoryRepo.save(category);
    }

    async reorderCategories(body: { categoryIds?: number[] }) {
        const categoryIds = Array.isArray(body.categoryIds) ? body.categoryIds.map(Number).filter(Boolean) : [];
        if (categoryIds.length === 0) throw CustomErrorHandler.validationError('categoryIds is required.');

        const categories = await this.categoryRepo.find();
        const categoryByPublicId = new Map<number, CategoryEntity>();
        categories.forEach((category) => {
            categoryByPublicId.set(Number(category.hostawayId || category.id), category);
        });

        for (let index = 0; index < categoryIds.length; index += 1) {
            const category = categoryByPublicId.get(categoryIds[index]);
            if (category) {
                category.displayOrder = index + 1;
                await this.categoryRepo.save(category);
            }
        }

        return await this.getAllCategories();
    }

    async getCategoryUsage(categoryId: number) {
        const category = await this.findByPublicId(categoryId);
        if (!category) throw CustomErrorHandler.notFound('Category not found.');
        const oldIds = new Set([String(category.id), String(category.hostawayId || category.id)]);
        const expenses = await this.expenseRepo.find({ select: ['id', 'categories'] as any });
        const usageCount = expenses.filter((expense) => this.parseCategoryIds(expense.categories).some((id) => oldIds.has(id))).length;
        return { categoryId, usageCount };
    }

    async deleteCategory(categoryId: number, body: { replacementCategoryId?: number; replacementCategoryName?: string }) {
        const category = await this.findByPublicId(categoryId);
        if (!category) throw CustomErrorHandler.notFound('Category not found.');

        let replacementId = body.replacementCategoryId ? Number(body.replacementCategoryId) : null;
        if (!replacementId && body.replacementCategoryName) {
            const replacement = await this.createInternalCategory(body.replacementCategoryName);
            replacementId = Number(replacement.hostawayId || replacement.id);
        }
        if (!replacementId) throw CustomErrorHandler.validationError('Choose an existing replacement category or create a new one.');
        if (String(replacementId) === String(categoryId)) throw CustomErrorHandler.validationError('Replacement category must be different.');

        const replacement = await this.findByPublicId(replacementId);
        if (!replacement) throw CustomErrorHandler.notFound('Replacement category not found.');

        const oldIds = new Set([String(category.id), String(category.hostawayId || category.id)]);
        const newId = String(replacement.hostawayId || replacement.id);
        const expenses = await this.expenseRepo.find();
        let updatedExpenseCount = 0;

        for (const expense of expenses) {
            const ids = this.parseCategoryIds(expense.categories);
            if (!ids.some((id) => oldIds.has(id))) continue;

            const nextIds = Array.from(new Set(ids.map((id) => oldIds.has(id) ? newId : id)));
            expense.categories = JSON.stringify(nextIds.map((id) => Number.isNaN(Number(id)) ? id : Number(id)));
            await this.expenseRepo.save(expense);
            updatedExpenseCount += 1;
        }

        await this.categoryRepo.remove(category);
        return { deletedCategoryId: categoryId, replacementCategoryId: replacementId, updatedExpenseCount };
    }

}
