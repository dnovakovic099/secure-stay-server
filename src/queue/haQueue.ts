import { Queue } from "bullmq";
import connection from "../utils/redisConnection";

export const haExpenseUpdateQueue = new Queue('ha-expense-queue', {
    connection,
});

export const haResolutionQueue = new Queue('ha-resolution-queue', {
    connection
});