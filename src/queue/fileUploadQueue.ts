import { Queue } from "bullmq";
import connection from "../utils/redisConnection";

const defaultJobOptions = {
    removeOnComplete: true,
    removeOnFail: { age: 3600 },
};

export const googleDriveFileUpload = new Queue('google-drive-file-upload', {
    connection,
    defaultJobOptions,
});