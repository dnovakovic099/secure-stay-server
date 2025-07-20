import { NextFunction, Request, Response } from "express";
import { ContactService } from "../services/ContactService";

interface CustomRequest extends Request {
    user?: any;
}

export class ContactController {
    async createContact(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            const createdContact = await contactService.createContact(request.body, request.user.id);
            return response.status(201).json(createdContact);
        } catch (error) {
            next(error);
        }
    }

    async updateContact(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            const updatedContact = await contactService.updateContact(request.body, request.user.id);
            return response.status(200).json(updatedContact);
        } catch (error) {
            next(error);
        }
    }

    async deleteContact(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            await contactService.deleteContact(Number(request.params.id), request.user.id);
            return response.status(200).json({ message: "Contact deleted successfully." });
        } catch (error) {
            next(error);
        }
    }

    async getContacts(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            const contacts = await contactService.getContacts({
                page: Number(request.query.page) || 1,
                limit: Number(request.query.limit) || 10,
                status: request.query.status as string[],
                listingId: request.query.listingId as string[],
                role: request.query.role as string[],
                name: request.query.name as string,
                contact: request.query.contact as string,
                website_name: request.query.website_name as string,
                rate: request.query.rate as string,
                paymentMethod: request.query.paymentMethod as string[],
                isAutoPay: request.query.isAutoPay ? request.query.isAutoPay === 'true' : undefined,
            }, request.user.id);
            return response.status(200).json(contacts);
        } catch (error) {
            next(error);
        }
    }
}
