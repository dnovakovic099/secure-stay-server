import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import logger from "../utils/logger.utils";
import { drive, getOrCreateFolder, uploadToDrive, deleteFromDrive } from "../utils/drive";

const execAsync = promisify(exec);

const BACKUP_FOLDER_NAME = "SECURE_STAY_DATABASE_BACKUP";
const LOCAL_BACKUP_DIR = path.join(process.cwd(), "backups");
const MAX_BACKUP_COUNT = 5;

type Phase =
    | "INIT"
    | "DUMP"
    | "VERIFY_LOCAL"
    | "DRIVE_AUTH"
    | "DRIVE_FOLDER"
    | "DRIVE_UPLOAD"
    | "CLEANUP_REMOTE"
    | "CLEANUP_LOCAL";

export class DatabaseBackupService {
    private runId: string;

    constructor() {
        this.runId = crypto.randomBytes(4).toString("hex");
    }

    private tag(phase: Phase, status: "START" | "END" | "SKIP" | "FAIL"): string {
        return `[backup runId=${this.runId} phase=${phase} status=${status}]`;
    }

    private logPhaseStart(phase: Phase, extra?: string): number {
        logger.info(`${this.tag(phase, "START")}${extra ? ` ${extra}` : ""}`);
        return Date.now();
    }

    private logPhaseEnd(phase: Phase, startedAt: number, extra?: string): void {
        const durationMs = Date.now() - startedAt;
        logger.info(`${this.tag(phase, "END")} durationMs=${durationMs}${extra ? ` ${extra}` : ""}`);
    }

    private logPhaseFail(phase: Phase, startedAt: number, error: unknown): void {
        const durationMs = Date.now() - startedAt;
        const err = error as { message?: string; code?: string | number; stack?: string };
        const message = err?.message || String(error);
        const code = err?.code !== undefined ? ` code=${err.code}` : "";
        logger.error(`${this.tag(phase, "FAIL")} durationMs=${durationMs}${code} message=${message}`);
        if (err?.stack) {
            logger.error(`[backup runId=${this.runId} phase=${phase}] stack: ${err.stack}`);
        }
    }

    /**
     * Creates a local database backup using mysqldump
     */
    async createBackup(): Promise<string> {
        const started = this.logPhaseStart("DUMP");

        if (!fs.existsSync(LOCAL_BACKUP_DIR)) {
            fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
            logger.info(`${this.tag("DUMP", "START")} created backup dir: ${LOCAL_BACKUP_DIR}`);
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
            const err = new Error("Database credentials not configured in environment variables");
            this.logPhaseFail("DUMP", started, err);
            throw err;
        }

        const dumpCommand = `mysqldump -h ${dbHost} -P ${dbPort} -u ${dbUser} -p'${dbPassword}' ${dbName} > "${backupFilePath}"`;
        logger.info(`${this.tag("DUMP", "START")} file=${backupFileName} host=${dbHost} port=${dbPort} db=${dbName}`);

        try {
            await execAsync(dumpCommand, { maxBuffer: 1024 * 1024 * 100 });
        } catch (error) {
            this.logPhaseFail("DUMP", started, error);
            throw error;
        }

        this.logPhaseEnd("DUMP", started, `path=${backupFilePath}`);
        return backupFilePath;
    }

    /**
     * Verifies the local backup file exists and is non-empty.
     */
    private verifyLocalBackup(backupFilePath: string): number {
        const started = this.logPhaseStart("VERIFY_LOCAL", `path=${backupFilePath}`);
        try {
            if (!fs.existsSync(backupFilePath)) {
                throw new Error(`Backup file does not exist at ${backupFilePath}`);
            }
            const stats = fs.statSync(backupFilePath);
            if (stats.size === 0) {
                throw new Error(`Backup file is empty (0 bytes) at ${backupFilePath}`);
            }
            this.logPhaseEnd("VERIFY_LOCAL", started, `sizeBytes=${stats.size}`);
            return stats.size;
        } catch (error) {
            this.logPhaseFail("VERIFY_LOCAL", started, error);
            throw error;
        }
    }

    /**
     * Uploads a backup file to the shared drive
     */
    async uploadBackupToDrive(backupFilePath: string): Promise<{ id: string; webViewLink: string }> {
        const sharedDriveId = process.env.SHARED_DRIVE_ID;

        if (!sharedDriveId) {
            const err = new Error("SHARED_DRIVE_ID not configured in environment variables");
            logger.error(`${this.tag("DRIVE_AUTH", "FAIL")} message=${err.message}`);
            throw err;
        }

        const authStarted = this.logPhaseStart("DRIVE_AUTH", `sharedDriveId=${sharedDriveId}`);
        try {
            await drive.about.get({ fields: "user(emailAddress)" });
            this.logPhaseEnd("DRIVE_AUTH", authStarted);
        } catch (error) {
            this.logPhaseFail("DRIVE_AUTH", authStarted, error);
            throw error;
        }

        const folderStarted = this.logPhaseStart("DRIVE_FOLDER", `folderName=${BACKUP_FOLDER_NAME}`);
        let backupFolderId: string;
        try {
            backupFolderId = await getOrCreateFolder(drive, BACKUP_FOLDER_NAME, sharedDriveId);
            this.logPhaseEnd("DRIVE_FOLDER", folderStarted, `folderId=${backupFolderId}`);
        } catch (error) {
            this.logPhaseFail("DRIVE_FOLDER", folderStarted, error);
            throw error;
        }

        const fileName = path.basename(backupFilePath);
        const fileSize = fs.statSync(backupFilePath).size;
        const uploadStarted = this.logPhaseStart("DRIVE_UPLOAD", `file=${fileName} sizeBytes=${fileSize}`);

        try {
            const uploadedFile = await uploadToDrive(
                backupFilePath,
                fileName,
                "application/sql",
                backupFolderId,
                sharedDriveId
            );

            if (!uploadedFile.id) {
                throw new Error("Drive upload returned no file id");
            }

            this.logPhaseEnd(
                "DRIVE_UPLOAD",
                uploadStarted,
                `fileId=${uploadedFile.id} webViewLink=${uploadedFile.webViewLink || "n/a"}`
            );

            return {
                id: uploadedFile.id,
                webViewLink: uploadedFile.webViewLink!
            };
        } catch (error) {
            this.logPhaseFail("DRIVE_UPLOAD", uploadStarted, error);
            throw error;
        }
    }

    /**
     * Cleans up old backups, keeping only the last MAX_BACKUP_COUNT files
     */
    async cleanupOldBackups(): Promise<void> {
        const started = this.logPhaseStart("CLEANUP_REMOTE");
        const sharedDriveId = process.env.SHARED_DRIVE_ID;

        if (!sharedDriveId) {
            const err = new Error("SHARED_DRIVE_ID not configured in environment variables");
            this.logPhaseFail("CLEANUP_REMOTE", started, err);
            throw err;
        }

        try {
            const backupFolderId = await getOrCreateFolder(drive, BACKUP_FOLDER_NAME, sharedDriveId);

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
            logger.info(`${this.tag("CLEANUP_REMOTE", "START")} foundFiles=${files.length} keep=${MAX_BACKUP_COUNT}`);

            if (files.length > MAX_BACKUP_COUNT) {
                const filesToDelete = files.slice(MAX_BACKUP_COUNT);
                logger.info(`${this.tag("CLEANUP_REMOTE", "START")} deleting=${filesToDelete.length}`);

                let deleted = 0;
                let failed = 0;
                for (const file of filesToDelete) {
                    try {
                        await deleteFromDrive(file.id!, file.name!);
                        deleted++;
                    } catch (deleteError) {
                        failed++;
                        logger.error(
                            `${this.tag("CLEANUP_REMOTE", "FAIL")} failed to delete ${file.name}: ${(deleteError as Error).message}`
                        );
                    }
                }
                this.logPhaseEnd("CLEANUP_REMOTE", started, `deleted=${deleted} failed=${failed}`);
            } else {
                this.logPhaseEnd("CLEANUP_REMOTE", started, "no old backups to delete");
            }
        } catch (error) {
            this.logPhaseFail("CLEANUP_REMOTE", started, error);
            throw error;
        }
    }

    /**
     * Cleans up the local backup file
     */
    cleanupLocalBackup(filePath: string): void {
        const started = this.logPhaseStart("CLEANUP_LOCAL", `path=${filePath}`);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                this.logPhaseEnd("CLEANUP_LOCAL", started, "deleted");
            } else {
                this.logPhaseEnd("CLEANUP_LOCAL", started, "file not present, skip");
            }
        } catch (error) {
            this.logPhaseFail("CLEANUP_LOCAL", started, error);
        }
    }

    /**
     * Processes the scheduled backup: creates backup, uploads to drive, cleans up old backups
     */
    async processScheduledBackup(): Promise<void> {
        const runStarted = this.logPhaseStart("INIT", "scheduled database backup");
        let backupFilePath: string | null = null;
        let uploadSucceeded = false;

        try {
            backupFilePath = await this.createBackup();

            this.verifyLocalBackup(backupFilePath);

            const uploadResult = await this.uploadBackupToDrive(backupFilePath);
            uploadSucceeded = true;
            logger.info(
                `[backup runId=${this.runId}] upload result fileId=${uploadResult.id} link=${uploadResult.webViewLink}`
            );

            await this.cleanupOldBackups();

            this.logPhaseEnd("INIT", runStarted, "overall status=SUCCESS");
        } catch (error) {
            this.logPhaseFail("INIT", runStarted, error);
            logger.error(
                `[backup runId=${this.runId}] overall status=FAIL uploadSucceeded=${uploadSucceeded} localBackup=${backupFilePath ?? "not created"}`
            );
            throw error;
        } finally {
            if (backupFilePath) {
                this.cleanupLocalBackup(backupFilePath);
            }
        }
    }
}
