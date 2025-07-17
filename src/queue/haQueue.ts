import { Queue } from "bullmq";
import connection from "../utils/redisConnection";

export const haExpenseUpdateQueue = new Queue('ha-expense-queue', {
    connection,
});

export const haResolutionQueue = new Queue('ha-resolution-queue', {
    connection
});

export const haResolutionUpdateQueue = new Queue('ha-resolution-update-queue', {
    connection
});

export const haResolutionDeleteQueue = new Queue('ha-resolution-delete-queue', {
    connection
});