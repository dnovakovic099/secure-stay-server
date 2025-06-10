import multer, { FileFilterCallback } from "multer";
import path from "path";
import { Request } from "express";
import fs from "fs";

// Sanitize the filename thoroughly
function sanitizeFilename(originalName) {
    const name = originalName.normalize('NFKD') // normalize unicode
        .replace(/[\u0300-\u036f]/g, '')          // remove diacritics
        .replace(/[^a-zA-Z0-9.-]/g, '_')          // allow only safe characters
        .replace(/_+/g, '_')                      // collapse multiple underscores
        .replace(/^_+|_+$/g, '')                  // trim underscores from start/end
        .toLowerCase();

    const timestamp = Date.now();
    const ext = path.extname(name).slice(0, 10); // limit extension length
    const base = path.basename(name, ext).slice(0, 100); // limit base length

    return `${timestamp}_${base}${ext}`;
}

// Define storage configuration
const fileStorage = (uploadPath: string) => multer.diskStorage({
    destination: (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
        const destinationPath = path.resolve(__dirname, `../../public/${uploadPath}`);

        // Check if the folder exists; if not, create it
        if (!fs.existsSync(destinationPath)) {
            fs.mkdirSync(destinationPath, { recursive: true });
        }

        cb(null, destinationPath);
    },
    filename: (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
        const safeFilename = sanitizeFilename(file.originalname);
        cb(null, safeFilename);
    }
});

const fileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowedFileTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|csv/;
    const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedFileTypes.test(file.mimetype);

    if (mimetype && extname) {
        cb(null, true);
    } else {
        cb(null, false);
    }
};

const fileUpload = (uploadPath: string) => multer({
    storage: fileStorage(uploadPath),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB
    },
    fileFilter: fileFilter
});

export default fileUpload;
