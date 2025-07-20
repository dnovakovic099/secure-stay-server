import { appDatabase } from "../utils/database.util";
import { Contact } from "../entity/Contact";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ILike, In } from "typeorm";
import { ListingService } from "./ListingService";
import { UsersEntity } from "../entity/Users";
import { Listing } from "../entity/Listing";

interface FilterQuery {
    page: number;
    limit: number;
    status?: string[];
    listingId?: string[];
    role?: string[];
    name?: string;
    contact?: string;
    website_name?: string;
    rate?: string;
    paymentMethod?: string[];
    isAutoPay?: boolean;
    propertyType?: number[];
}

export class ContactService {
    private contactRepo = appDatabase.getRepository(Contact);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepository = appDatabase.getRepository(Listing);

    async createContact(body: Partial<Contact>, userId: string) {
        const contact = this.contactRepo.create({
            ...body,
            createdBy: userId,
            updatedBy: userId,
        });
        return await this.contactRepo.save(contact);
    }

    async updateContact(body: Partial<Contact>, userId: string) {
        const existing = await this.contactRepo.findOneBy({ id: body.id });
        if (!existing) {
            throw CustomErrorHandler.notFound(`Contact with ID ${body.id} not found.`);
        }

        const updated = this.contactRepo.merge(existing, {
            ...body,
            updatedBy: userId,
        });

        return await this.contactRepo.save(updated);
    }

    async deleteContact(id: number, userId: string) {
        const contact = await this.contactRepo.findOneBy({ id });
        if (!contact) {
            throw CustomErrorHandler.notFound(`Contact with ID ${id} not found.`);
        }

        contact.deletedBy = userId;
        await this.contactRepo.save(contact);
        return await this.contactRepo.softRemove(contact);
    }

    async getContacts(query: FilterQuery, userId: string) {
        const {
            page,
            limit,
            status,
            listingId,
            role,
            name,
            contact,
            website_name,
            rate,
            paymentMethod,
            isAutoPay,
            propertyType
        } = query;

        let listingIds = [];
        const listingService = new ListingService();
        const listings = await listingService.getListingNames(userId);
        
        if (propertyType && propertyType.length > 0) {
            listingIds = (await listingService.getListingsByTagIds(propertyType, userId)).map(l => l.id);
        } else {
            listingIds = listingId;
        }

        const [data, total] = await this.contactRepo.findAndCount({
            where: {
                ...(status && status.length > 0 && { status: In(status) }),
                ...(listingId && listingId.length > 0 && { listingId: In(listingIds) }),
                ...(role && role.length > 0 && { role: In(role) }),
                ...(paymentMethod && paymentMethod.length > 0 && { paymentMethod: In(paymentMethod) }),
                ...(isAutoPay !== undefined && { isAutoPay }),
                ...(name && { name: ILike(`%${name}%`) }),
                ...(contact && { contact: ILike(`%${contact}%`) }),
                ...(website_name && { website_name: ILike(`%${website_name}%`) }),
                ...(rate && { rate }),
            },
            skip: (page - 1) * limit,
            take: limit,
            order: { name: "DESC" },
        });

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));


        const transformedData = data.map(d => {
            return {
                ...d,
                listingName: listings.find((listing) => listing.id == Number(d.listingId))?.internalListingName,
                createdBy: userMap.get(d.createdBy) || d.createdBy,
                updatedBy: userMap.get(d.updatedBy) || d.updatedBy,
            };
        });

        return {
            contacts: transformedData,
            total
        };
    }


}
