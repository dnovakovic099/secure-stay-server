import multer, { FileFilterCallback } from "multer";
import path from "path";
import { Request } from "express";
import fs from "fs";

// Define storage configuration
const fileStorage = multer.diskStorage({
    destination: (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
        const destinationPath = path.resolve(__dirname, '../../public/issues');

        // Check if the folder exists; if not, create it
        if (!fs.existsSync(destinationPath)) {
            fs.mkdirSync(destinationPath, { recursive: true });
        }

        cb(null, destinationPath);
    },
    filename: (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
        cb(null, `${Date.now()}-${file.originalname}`);
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

const fileUpload = multer({
    storage: fileStorage,
    limits: {
        fileSize: 2 * 1024 * 1024, // 2 MB
    },
    fileFilter: fileFilter
});

export default fileUpload;
