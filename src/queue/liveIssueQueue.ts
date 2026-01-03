import { Queue } from "bullmq";
import connection from "../utils/redisConnection";

export const createLiveIssueFromResolution = new Queue('create-live-issue-from-resolution', {
    connection,
});

export const updateLiveIssueFromResolution = new Queue('update-live-issue-from-resolution', {
    connection,
});
