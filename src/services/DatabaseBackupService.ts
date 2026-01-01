import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import logger from "../utils/logger.utils";
import { drive, getOrCreateFolder, uploadToDrive, deleteFromDrive } from "../utils/drive";

const execAsync = promisify(exec);

const BACKUP_FOLDER_NAME = "SECURE_STAY_DATABASE_BACKUP";
const LOCAL_BACKUP_DIR = path.join(process.cwd(), "backups");
const MAX_BACKUP_COUNT = 5;

export class DatabaseBackupService {
    /**
     * Creates a local database backup using mysqldump
     * @returns The path to the created backup file
     */
    async createBackup(): Promise<string> {
        // Ensure backup directory exists
        if (!fs.existsSync(LOCAL_BACKUP_DIR)) {
            fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const backupFileName = `secure_stay_backup_${timestamp}.sql`;
        const backupFilePath = path.join(LOCAL_BACKUP_DIR, backupFileName);

        const dbHost = process.env.DATABASE_URL || "localhost";
        const dbPort = process.env.DATABASE_PORT || "3306";
        const dbUser = process.env.DATABASE_USERNAME;
        const dbPassword = process.env.DATABASE_PASSWORD;
        const dbName = process.env.DATABASE_NAME;

        if (!dbUser || !dbPassword || !dbName) {
            throw new Error("Database credentials not configured in environment variables");
        }

        // Build mysqldump command
        const dumpCommand = `mysqldump -h ${dbHost} -P ${dbPort} -u ${dbUser} -p'${dbPassword}' ${dbName} > "${backupFilePath}"`;

        try {
            logger.info(`Creating database backup: ${backupFileName}`);
            await execAsync(dumpCommand);
            logger.info(`Database backup created successfully: ${backupFilePath}`);
            return backupFilePath;
        } catch (error) {
            logger.error("Failed to create database backup:", error);
            throw error;
        }
    }

    /**
     * Uploads a backup file to the shared drive
     * @param backupFilePath Path to the local backup file
     * @returns The uploaded file data including id and links
     */
    async uploadBackupToDrive(backupFilePath: string): Promise<{ id: string; webViewLink: string }> {
        const sharedDriveId = process.env.SHARED_DRIVE_ID;

        if (!sharedDriveId) {
            throw new Error("SHARED_DRIVE_ID not configured in environment variables");
        }

        // Get or create the backup folder in the shared drive
        const backupFolderId = await getOrCreateFolder(drive, BACKUP_FOLDER_NAME, sharedDriveId);

        const fileName = path.basename(backupFilePath);

        try {
            logger.info(`Uploading backup to shared drive: ${fileName}`);
            const uploadedFile = await uploadToDrive(
                backupFilePath,
                fileName,
                "application/sql",
                backupFolderId,
                sharedDriveId
            );

            logger.info(`Backup uploaded successfully. File ID: ${uploadedFile.id}`);
            return {
                id: uploadedFile.id!,
                webViewLink: uploadedFile.webViewLink!
            };
        } catch (error) {
            logger.error("Failed to upload backup to shared drive:", error);
            throw error;
        }
    }

    /**
     * Cleans up old backups, keeping only the last MAX_BACKUP_COUNT files
     */
    async cleanupOldBackups(): Promise<void> {
        const sharedDriveId = process.env.SHARED_DRIVE_ID;

        if (!sharedDriveId) {
            throw new Error("SHARED_DRIVE_ID not configured in environment variables");
        }

        try {
            // Get the backup folder ID
            const backupFolderId = await getOrCreateFolder(drive, BACKUP_FOLDER_NAME, sharedDriveId);

            // List all files in the backup folder
            const response = await drive.files.list({
                q: `'${backupFolderId}' in parents and trashed = false`,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
                corpora: "drive",
                driveId: sharedDriveId,
                fields: "files(id, name, createdTime)",
                orderBy: "createdTime desc"
            });

            const files = response.data.files || [];
            logger.info(`Found ${files.length} backup files in shared drive`);

            // If we have more than MAX_BACKUP_COUNT files, delete the oldest ones
            if (files.length > MAX_BACKUP_COUNT) {
                const filesToDelete = files.slice(MAX_BACKUP_COUNT);
                logger.info(`Deleting ${filesToDelete.length} old backup files`);

                for (const file of filesToDelete) {
                    try {
                        await deleteFromDrive(file.id!, file.name!);
                    } catch (deleteError) {
                        logger.error(`Failed to delete backup ${file.name}:`, deleteError);
                    }
                }
            } else {
                logger.info("No old backups to delete");
            }
        } catch (error) {
            logger.error("Failed to cleanup old backups:", error);
            throw error;
        }
    }

    /**
     * Cleans up the local backup file
     * @param filePath Path to the local backup file
     */
    cleanupLocalBackup(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logger.info(`Local backup file deleted: ${filePath}`);
            }
        } catch (error) {
            logger.error("Failed to delete local backup file:", error);
        }
    }

    /**
     * Processes the scheduled backup: creates backup, uploads to drive, cleans up old backups
     */
    async processScheduledBackup(): Promise<void> {
        let backupFilePath: string | null = null;

        try {
            logger.info("Starting scheduled database backup process...");

            // Step 1: Create local backup
            backupFilePath = await this.createBackup();

            // Step 2: Upload to shared drive
            const uploadResult = await this.uploadBackupToDrive(backupFilePath);
            logger.info(`Backup uploaded to shared drive: ${uploadResult.webViewLink}`);

            // Step 3: Cleanup old backups from shared drive
            await this.cleanupOldBackups();

            logger.info("Scheduled database backup process completed successfully");
        } catch (error) {
            logger.error("Scheduled database backup process failed:", error);
            throw error;
        } finally {
            // Step 4: Clean up local temp file
            if (backupFilePath) {
                this.cleanupLocalBackup(backupFilePath);
            }
        }
    }
}
