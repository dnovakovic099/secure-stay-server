import { Queue } from "bullmq";
import connection from "../utils/redisConnection";

export const googleDriveFileUpload = new Queue('google-drive-file-upload', {
    connection,
});

export const activityQueue = new Queue("activity-queue", {
    connection,
});