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

// 🔹 Helper: Delete file from Drive
export async function deleteFromDrive(fileId: string) {
    try {
        await drive.files.delete({
            fileId,
            supportsAllDrives: true, // 🔑 needed for shared drives
        });
        logger.info(`🗑️ Deleted file from Drive: ${fileId}`);
        return true;
    } catch (err) {
        logger.error(`❌ Failed to delete file ${fileId}:`, err);
        return false;
    }
}

