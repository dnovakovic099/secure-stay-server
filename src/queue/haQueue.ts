import { Queue } from "bullmq";
import connection from "../utils/redisConnection";

const defaultJobOptions = {
    removeOnComplete: true,
    removeOnFail: { age: 3600 },
};

export const haExpenseUpdateQueue = new Queue('ha-expense-queue', {
    connection,
    defaultJobOptions,
});

export const haResolutionQueue = new Queue('ha-resolution-queue', {
    connection,
    defaultJobOptions,
});

export const haResolutionUpdateQueue = new Queue('ha-resolution-update-queue', {
    connection,
    defaultJobOptions,
});

export const haResolutionDeleteQueue = new Queue('ha-resolution-delete-queue', {
    connection,
    defaultJobOptions,
});