import { NextFunction, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { drive } from "../utils/drive";

export class FileController {
    async getFile(request: Request, response: Response, next: NextFunction) {

        const fileName = request.params.file;
        const module = request.params.module;

        if (!fileName) {
            return response.status(400).json({ error: 'File name is required' });
        }

        const filePath = path.join(__dirname, `../../public/${module}`, fileName);
         console.log(filePath)
        fs.access(filePath, fs.constants.F_OK, (err) => {
            if (err) {
                console.log(err)
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

    async getImage(request: Request, response: Response, next: NextFunction) {
        const fileName = request.params.file;
        const module = request.params.module;

        if (!fileName) {
            return response.status(400).json({ error: 'File name is required' });
        }

        const filePath = path.join(__dirname, `../../public/${module}`, fileName);

        fs.access(filePath, fs.constants.F_OK, (err) => {
            if (err) {
                return response.status(404).json({ error: 'Image not found' });
            }

            // Check if the file is an image by its extension
            const fileExtension = path.extname(fileName).toLowerCase();
            const allowedImageTypes: { [key: string]: string } = {
                '.jpeg': 'image/jpeg',
                '.jpg': 'image/jpeg', 
                '.png': 'image/png',
                '.webp': 'image/webp',
                '.heic': 'image/heic',
                '.heif': 'image/heif'
            }

            if (!allowedImageTypes[fileExtension]) {
                return response.status(400).json({ error: 'Invalid image format' });
            }

            // Set the content-type header for the image
            response.setHeader('Content-Type', allowedImageTypes[fileExtension]);

            // Stream the image file to the response
            fs.createReadStream(filePath).pipe(response);
        });
    }

    async getDriveImage(request: Request, response: Response, next: NextFunction) {
        try {
            const fileId = request.params.fileId;
            if (!fileId) {
                return response.status(400).json({ error: 'File ID is required' });
            }

            // Get file metadata to determine mime type
            const metadataResponse = await drive.files.get({
                fileId: fileId,
                fields: 'mimeType',
                supportsAllDrives: true,
            });

            const mimeType = metadataResponse.data.mimeType;

            // Optional: you can check if it's an image mimeType here

            response.setHeader('Content-Type', mimeType || 'application/octet-stream');
            response.setHeader('Cache-Control', 'public, max-age=31536000');

            // Download file stream from Google Drive
            const fileStream = await drive.files.get(
                {
                    fileId: fileId,
                    alt: 'media',
                    supportsAllDrives: true,
                },
                { responseType: 'stream' }
            );

            // Pipe the stream directly to the express response
            fileStream.data.pipe(response);

            // Handle stream events
            fileStream.data.on('error', (err) => {
                console.error('Error streaming file from Drive:', err);
                if (!response.headersSent) {
                    response.status(500).json({ error: 'Error streaming file' });
                }
            });

        } catch (error: any) {
            console.error('Error fetching image from Drive:', error.message);
            if (!response.headersSent) {
                response.status(500).json({ error: 'Failed to retrieve image from Drive' });
            }
        }
    }
}