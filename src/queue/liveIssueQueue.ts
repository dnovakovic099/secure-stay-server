import { Queue } from "bullmq";
import connection from "../utils/redisConnection";

const defaultJobOptions = {
    removeOnComplete: true,
    removeOnFail: { age: 3600 },
};

export const createLiveIssueFromResolution = new Queue('create-live-issue-from-resolution', {
    connection,
    defaultJobOptions,
});

export const updateLiveIssueFromResolution = new Queue('update-live-issue-from-resolution', {
    connection,
    defaultJobOptions,
});
