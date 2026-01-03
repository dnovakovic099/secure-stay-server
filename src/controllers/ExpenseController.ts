import { NextFunction, Request, Response } from "express";
import { ExpenseService } from "../services/ExpenseService";

interface CustomRequest extends Request {
    user?: any;
}

export class ExpenseController {
    async createExpense(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;

            //check either attachments are present or not

            let fileInfo: { fileName: string, filePath: string, mimeType: string; originalName: string; }[] | null = null;

            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                fileInfo = (request.files['attachments'] as Express.Multer.File[]).map(file => {
                    return {
                        fileName: file.filename,
                        filePath: file.path,
                        mimeType: file.mimetype,
                        originalName: file.originalname
                    };
                }
                );
            }

            const expenseData = await expenseService.createExpense(request, userId, fileInfo);

            return response.send(expenseData);
        } catch (error) {
            return next(error);
        }
    }

    async updateExpense(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;

            //check either attachments are present or not
            let fileNames: string[] = [];
            let fileInfo: { fileName: string, filePath: string, mimeType: string; originalName: string; }[] | null = null;

            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                fileInfo = (request.files['attachments'] as Express.Multer.File[]).map(file => {
                    return {
                        fileName: file.filename,
                        filePath: file.path,
                        mimeType: file.mimetype,
                        originalName: file.originalname
                    };
                }
                );
            }

            // Parse oldFiles safely
            const oldFiles: string[] = JSON.parse(request.body.oldFiles) || [];

            fileNames = [...oldFiles, ...(fileInfo ? fileInfo.map(file => file.fileName) : [])];

            const expenseData = await expenseService.updateExpense(request, userId, fileNames, fileInfo);

            return response.send(expenseData);
        } catch (error) {
            return next(error);
        }
    }

    async deleteExpense(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;
            const id = parseInt(request.params.id);

            await expenseService.deleteExpense(id, userId);

            return response.send({ message: 'Expense deleted successfully' });
        } catch (error) {
            return next(error);
        }
    }

    async updateExpenseStatus(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;

            const expenseData = await expenseService.updateExpenseStatus(request, userId);

            return response.send(expenseData);
        } catch (error) {
            return next(error);
        }
    }

    async getExpenseList(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;
            return response.send(await expenseService.getExpenseList(request, userId));
        } catch (error) {
            return next(error);
        }
    };

    async getExpenseById(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;
            const id = parseInt(request.params.id);
            return response.send(await expenseService.getExpenseById(id, userId));
        } catch (error) {
            return next(error);
        }
    }

    async getTotalExpenseByUserId(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.userId;
            const listingId = parseInt(request.params.listingId) || null;
            return response.send(await expenseService.getTotalExpenseByUserId(userId, listingId));
        } catch (error) {
            return next(error);
        }
    }

    async migrateExpenseCatgory(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const fromId = request.body.fromId || 1; // Default to 1 if not provided
            const toId = request.body.toId;
            const result = await expenseService.migrateExpenseCategoryIdsInRange(fromId, toId);
            return response.status(200).json({ message: 'Expense categories migrated successfully', result });
        } catch (error) {
            return next(error);
        }
    }


    async fixPositiveExpensesAndSync(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;
            const limit = request.query.limit;
            const result = await expenseService.fixPositiveExpensesAndSync(userId, Number(limit));
            return response.status(200).json({ message: 'Positive expenses fixed and synced successfully', result });
        } catch (error) {
            return next(error);
        }
    }

    async fixPositiveExpensesLocal(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;
            const categoryName = request.query.category ? String(request.query.category) : undefined;
            const limit = request.query.limit ? Number(request.query.limit) : undefined;
            const dryRun = request.query.dryRun === 'true' || request.query.dryRun === '1';
            const result = await expenseService.fixPositiveExpensesLocal(userId, categoryName, limit, dryRun);
            return response.status(200).json(result);
        } catch (error) {
            return next(error);
        }
    }

    async bulkUpdateExpenses(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;
            const result = await expenseService.bulkUpdateExpense(request.body, userId);
            return response.status(200).json(result);
        } catch (error) {
            return next(error);
        }
    }

    async migrateFilesToDrive(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const result = await expenseService.migrateFilesToDrive();
            return response.status(200).json({ message: 'Files migrated to drive successfully', result });
        } catch (error) {
            return next(error);
        }
    }

    async deleteDuplicateExpenses(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const { type, targetDate, dryRun } = request.query;

            if (!targetDate) {
                return response.status(400).json({ error: 'targetDate query parameter is required (format: yyyy-MM-dd)' });
            }

            const isDryRun = dryRun === 'true' || dryRun === '1';

            let result;
            if (type === 'recurring') {
                result = await expenseService.deleteDuplicateRecurringExpenses(String(targetDate), isDryRun);
            } else {
                // Default to tech_fee
                result = await expenseService.deleteDuplicateTechFeeExpenses(String(targetDate), isDryRun);
            }

            return response.status(200).json({
                message: isDryRun
                    ? `Dry run complete. Found ${result.duplicatesFound} duplicate ${type || 'tech_fee'} expenses.`
                    : `Successfully deleted ${result.duplicatesDeleted} duplicate ${type || 'tech_fee'} expenses.`,
                result
            });
        } catch (error) {
            return next(error);
        }
    }
}

