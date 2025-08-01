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

export async function uploadFileToSlack(
    channelId: string,
    fileNames: string[],
    moduleFolder: string
): Promise<void> {
    for (const fileName of fileNames) {
        const filePath = path.join(__dirname, `../../public/${moduleFolder}`, fileName);

        if (!fs.existsSync(filePath)) {
            logger.warn(`File not found: ${filePath}`);
            continue;
        }

        try {
            const result = await web.files.uploadV2({
                channel_id: channelId,
                initial_comment: ``,
                file: fs.createReadStream(filePath),
                filename: fileName,
            });

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
