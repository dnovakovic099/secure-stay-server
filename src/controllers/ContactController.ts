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
                propertyType: request.query.propertyType as any[],
                email: request.query.email as string,
                source: request.query.source as string[],
                keyword: request.query.keyword as string,
                state: request.query.state as string[],
                city: request.query.city as string[],
                paidBy: request.query.paidBy as string[],
            }, request.user.id);
            return response.status(200).json(contacts);
        } catch (error) {
            next(error);
        }
    }

    async createContactRole(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            const createdRole = await contactService.createContactRole(request.body, request.user.id);
            return response.status(201).json(createdRole);
        } catch (error) {
            next(error);
        }
    }

    async updateContactRole(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            const updatedRole = await contactService.updateContactRole(request.body, request.user.id);
            return response.status(200).json(updatedRole);
        } catch (error) {
            next(error);
        }
    }

    async deleteContactRole(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            await contactService.deleteContactRole(Number(request.params.id), request.user.id);
            return response.status(200).json({ message: "Contact role deleted successfully." });
        } catch (error) {
            next(error);
        }
    }

    async getContactRoles(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            const roles = await contactService.getContactRoles();
            return response.status(200).json(roles);
        } catch (error) {
            next(error);
        }
    }


    async createContactUpdate(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            const createdUpdate = await contactService.createContactUpdates(request.body, request.user.id);
            return response.status(201).json(createdUpdate);
        } catch (error) {
            next(error);
        }
    }

    async updateContactUpdate(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            const updatedUpdate = await contactService.updateContactUpdates(request.body, request.user.id);
            return response.status(200).json(updatedUpdate);
        } catch (error) {
            next(error);
        }
    }

    async deleteContactUpdate(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            await contactService.deleteContactUpdates(Number(request.params.id), request.user.id);
            return response.status(200).json({ message: "Contact update deleted successfully." });
        } catch (error) {
            next(error);
        }
    }

    async bulkUpdateContacts(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { ids, updateData } = request.body;
            
            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return response.status(400).json({ 
                    error: "IDs array is required and must not be empty" 
                });
            }

            if (!updateData || Object.keys(updateData).length === 0) {
                return response.status(400).json({ 
                    error: "Update data is required and must not be empty" 
                });
            }

            const contactService = new ContactService();
            const result = await contactService.bulkUpdateContacts(ids, updateData, request.user.id);
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async getContactList(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            const contacts = await contactService.getContactList(request.query.keyword as string);
            return response.status(200).json(contacts);
        } catch (error) {
            next(error);
        }
    }

    async getCleanersByListing(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            const cleaners = await contactService.getCleanersByListing(request.params.listingId);
            return response.status(200).json(cleaners);
        } catch (error) {
            next(error);
        }
    }

    async getPrimaryCleanerForListing(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const contactService = new ContactService();
            const cleaner = await contactService.getPrimaryCleanerForListing(request.params.listingId);
            return response.status(200).json(cleaner);
        } catch (error) {
            next(error);
        }
    }

}
