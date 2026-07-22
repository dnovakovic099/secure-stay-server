import { WebClient } from '@slack/web-api';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import logger from './logger.utils';

dotenv.config();

// Slack bot token and channel ID
const token = process.env.SLACK_BOT_TOKEN;

// Initialize Slack client
const web = new WebClient(token);

interface UploadFileToSlackOptions {
    groupFilesInSingleMessage?: boolean;
}

export async function uploadFileToSlack(
    channelId: string,
    fileNames: string[],
    moduleFolder: string,
    threadTs?: string,
    initialComment = "",
    options: UploadFileToSlackOptions = {}
): Promise<void> {
    if (options.groupFilesInSingleMessage) {
        const fileUploads = fileNames
            .map((fileName) => {
                const filePath = path.join(__dirname, `../../public/${moduleFolder}`, fileName);

                if (!fs.existsSync(filePath)) {
                    logger.warn(`File not found: ${filePath}`);
                    return null;
                }

                return {
                    file: fs.createReadStream(filePath),
                    filename: fileName,
                };
            })
            .filter((upload): upload is { file: fs.ReadStream; filename: string } => Boolean(upload));

        if (fileUploads.length === 0) return;

        try {
            const uploadArgs: Parameters<typeof web.files.uploadV2>[0] = {
                channel_id: channelId,
                initial_comment: initialComment,
                file_uploads: fileUploads,
                ...(threadTs ? { thread_ts: threadTs } : {}),
            };
            const result = await web.files.uploadV2(uploadArgs);

            if (result.ok) {
                logger.info(`Uploaded ${fileUploads.length} file(s) to Slack successfully.`);
            } else {
                logger.warn(`Failed to upload grouped files to Slack. Slack response:`, result);
            }
        } catch (error) {
            logger.error(`Error uploading grouped files to Slack:`, error);
        }

        return;
    }

    for (const [index, fileName] of fileNames.entries()) {
        const filePath = path.join(__dirname, `../../public/${moduleFolder}`, fileName);

        if (!fs.existsSync(filePath)) {
            logger.warn(`File not found: ${filePath}`);
            continue;
        }

        try {
            const uploadArgs: Parameters<typeof web.files.uploadV2>[0] = threadTs
                ? {
                    channels: channelId,
                    thread_ts: threadTs,
                    initial_comment: index === 0 ? initialComment : ``,
                    file: fs.createReadStream(filePath),
                    filename: fileName,
                }
                : {
                    channel_id: channelId,
                    initial_comment: index === 0 ? initialComment : ``,
                    file: fs.createReadStream(filePath),
                    filename: fileName,
                };
            const result = await web.files.uploadV2(uploadArgs);

            if (result.ok) {
                logger.info(`Uploaded ${fileName} to Slack successfully.`);
            } else {
                logger.warn(`Failed to upload ${fileName}. Slack response:`, result);
            }
        } catch (error) {
            logger.error(`Error uploading ${fileName}:`, error);
        }
    }
}
