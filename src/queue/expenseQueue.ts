import { Queue } from "bullmq";
import connection from "../utils/redisConnection";

const defaultJobOptions = {
    removeOnComplete: true,
    removeOnFail: { age: 3600 }, // keep failed jobs for 1 hour for debugging
};

export const createExpenseFromResolution = new Queue('create-expense-from-resolution', {
    connection,
    defaultJobOptions,
});

export const updateExpenseFromResolution = new Queue('update-expense-from-resolution', {
    connection,
    defaultJobOptions,
});

export const updateResolutionFromExpense = new Queue('update-resolution-from-expense', {
    connection,
    defaultJobOptions,
});
