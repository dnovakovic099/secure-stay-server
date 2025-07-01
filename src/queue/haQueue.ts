import { Queue } from "bullmq";
import connection from "../utils/redisConnection";

export const haExpenseUpdateQueue = new Queue('ha-expense-queue', {
    connection,
});

