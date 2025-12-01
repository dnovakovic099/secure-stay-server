import { Queue } from "bullmq";
import connection from "../utils/redisConnection";

export const createExpenseFromResolution = new Queue('create-expense-from-resolution', {
    connection,
});

export const updateExpenseFromResolution = new Queue('update-expense-from-resolution', {
    connection,
});

export const updateResolutionFromExpense = new Queue('update-resolution-from-expense', {
    connection
});
