import { google, drive_v3 } from "googleapis";
import path from "path";
import fs from "fs";
import logger from "./logger.utils";

const KEYFILEPATH = path.join(process.cwd(), "service-account.json");
const SCOPES = ["https://www.googleapis.com/auth/drive"];

const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: SCOPES,
});

export const drive = google.drive({ version: "v3", auth });

// 🔹 Root folder (like S3 bucket)
const ROOT_FOLDER_NAME = "Securestay"; // change as you like
let ROOT_FOLDER_ID: string | null = null;

// 🔹 Helper: Find or create folder
export async function getOrCreateFolder(
    drive: drive_v3.Drive,
    folderName: string,
    parentFolderId: string
): Promise<string> {
    const res = await drive.files.list({
        q: `'${parentFolderId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: "drive",
        driveId: process.env.SHARED_DRIVE_ID,
        fields: "files(id, name)",
    });

    if (res.data.files && res.data.files.length > 0) {
        return res.data.files[0].id!;
    }

    const folderMetadata = {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
        driveId: process.env.SHARED_DRIVE_ID,
    };

    const folder = await drive.files.create({
        requestBody: folderMetadata,
        supportsAllDrives: true,
        fields: "id",
    });

    return folder.data.id!;
}

// 🔹 Helper: Upload file to Drive
export async function uploadToDrive(
    filePath: string,
    fileName: string,
    mimeType: string,
    folderId: string,
    driveId: string // 🔑 pass shared driveId here
) {
    const fileMetadata = {
        name: fileName,
        parents: [folderId],
        driveId,                 // 🔑 target shared drive
    };

    const media = {
        mimeType,
        body: fs.createReadStream(filePath),
    };

    const response = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: "id, webViewLink, webContentLink",
        supportsAllDrives: true,  // 🔑 needed
    });

    // Make file public
    await drive.permissions.create({
        fileId: response.data.id!,
        requestBody: {
            role: "reader",
            type: "anyone",
        },
        supportsAllDrives: true,  // 🔑 also here
    });

    return response.data;
}

// 🔹 Init root folder (call this once at startup)
export async function initRootFolder() {
    if (!ROOT_FOLDER_ID) {
        // use SHARED_DRIVE_ID instead of "root"
        const SHARED_DRIVE_ID = process.env.SHARED_DRIVE_ID;

        // create/find Secure Stay inside shared drive
        ROOT_FOLDER_ID = await getOrCreateFolder(
            drive,
            ROOT_FOLDER_NAME,
            SHARED_DRIVE_ID // 👈 parent is the shared drive root
        );

        console.log(`📂 Root folder ready: ${ROOT_FOLDER_NAME} (${ROOT_FOLDER_ID})`);
    }
    return ROOT_FOLDER_ID;
}

// 🔹 Get root folder id
export function getRootFolderId() {
    if (!ROOT_FOLDER_ID) {
        return initRootFolder();
    }
    return ROOT_FOLDER_ID;
}

// 🔹 Helper: Delete file from Drive (with shared drive workaround)
export async function deleteFromDrive(fileId: string, fileName?: string) {
    const fileIdentifier = fileName ? `${fileName} (${fileId})` : fileId;

    // First, try moving file to trash (works better on shared drives)
    try {
        await drive.files.update({
            fileId,
            supportsAllDrives: true,
            requestBody: {
                trashed: true
            }
        });
        logger.info(`🗑️ Moved file to trash: ${fileIdentifier}`);
        return true;
    } catch (trashErr: any) {
        const trashErrorCode = trashErr?.code || trashErr?.response?.status;
        logger.warn(`Trash attempt failed for ${fileIdentifier} - Code: ${trashErrorCode}, trying direct delete...`);

        // If trashing fails, try direct deletion
        try {
            await drive.files.delete({
                fileId,
                supportsAllDrives: true,
            });
            logger.info(`🗑️ Deleted file from Drive: ${fileIdentifier}`);
            return true;
        } catch (deleteErr: any) {
            const errorCode = deleteErr?.code || deleteErr?.response?.status;
            const errorMessage = deleteErr?.message || 'Unknown error';
            const errorReason = deleteErr?.errors?.[0]?.reason || 'unknown';

            logger.warn(`Delete attempt also failed for ${fileIdentifier} - Code: ${errorCode}, Reason: ${errorReason}, Message: ${errorMessage}`);

            // If both fail with 404, the file is already gone
            if (errorCode === 404 && trashErrorCode === 404) {
                logger.info(`File ${fileIdentifier} already deleted or not found, skipping`);
                return true;
            }

            logger.error(`❌ Failed to delete file ${fileIdentifier}:`, deleteErr);
            return false;
        }
    }
}
