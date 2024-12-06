import { NextFunction, Request, Response } from "express";
import path from "path";
import fs from "fs";

export class FileController {
    async getFile(request: Request, response: Response, next: NextFunction) {

        const fileName = request.params.file;
        const module = request.params.module;

        if (!fileName) {
            return response.status(400).json({ error: 'File name is required' });
        }

        const filePath = path.join(__dirname, `../../public/${module}`, fileName);

        fs.access(filePath, fs.constants.F_OK, (err) => {
            if (err) {
                return response.status(404).json({ error: 'File not found' });
            }

            // Set the content-type header based on the file extension
            const fileExtension = path.extname(fileName).toLowerCase();
            const mimeTypes: { [key: string]: string; } = {
                '.jpeg': 'image/jpeg',
                '.jpg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.pdf': 'application/pdf',
                '.csv': 'text/csv',
                '.txt': 'text/plain',
                '.doc': 'application/msword',
                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                '.xls': 'application/vnd.ms-excel',
                '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            };
            const contentType = mimeTypes[fileExtension] || 'application/octet-stream';
            response.setHeader('Content-Type', contentType);

            // Stream the image file to the response
            fs.createReadStream(filePath).pipe(response);
        });
    };
}