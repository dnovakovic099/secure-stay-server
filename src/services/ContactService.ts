import { appDatabase } from "../utils/database.util";
import { Contact } from "../entity/Contact";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ILike, In } from "typeorm";
import { ListingService } from "./ListingService";
import { UsersEntity } from "../entity/Users";
import { Listing } from "../entity/Listing";
import { ListingTags } from "../entity/ListingTags";
import { tagIds } from "../constant";
import { ListingDetail } from "../entity/ListingDetails";
import { ContactRole } from "../entity/ContactRole";
import { ContactUpdates } from "../entity/ContactUpdates";
import { ListingSchedule } from "../entity/ListingSchedule";

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
    source?: string[];
    email?: string;
    keyword?: string;
    state?: string[];
    city?: string[];
}

export class ContactService {
    private contactRepo = appDatabase.getRepository(Contact);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepository = appDatabase.getRepository(Listing);
    private listingTagRepo = appDatabase.getRepository(ListingTags);
    private listingDetailRepo = appDatabase.getRepository(ListingDetail);
    private contactRoleRepo = appDatabase.getRepository(ContactRole);
    private contactUpdatesRepo = appDatabase.getRepository(ContactUpdates);
    private listingScheduleRepo = appDatabase.getRepository(ListingSchedule);

    async createContact(body: Partial<Contact>, userId: string) {
        const contact = this.contactRepo.create({
            ...body,
            createdBy: userId,
            updatedBy: userId,
            paymentDayOfWeek: body.paymentDayOfWeek ? JSON.stringify(body.paymentDayOfWeek) : null
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
            paymentDayOfWeek: body.paymentDayOfWeek ? JSON.stringify(body.paymentDayOfWeek) : null
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
            propertyType,
            source,
            email,
            keyword,
            state,
            city
        } = query;

        let listingIds = [];
        const listingService = new ListingService();
        const listings = await listingService.getListingNames(userId);
        
        const hasPropertyType = propertyType && propertyType.length > 0;
        const hasState = state && state.length > 0;
        const hasCity = city && city.length > 0;

        if (hasPropertyType) {
            let listings = await listingService.getListingsByTagIds(propertyType, userId);

            if (hasState) {
                listings = listings.filter(l => l.state && state.includes(l.state));
            }

            if (hasCity) {
                listings = listings.filter(l => l.city && city.includes(l.city));
            }

            listingIds = listings.map(l => l.id);
        } else {
            let listings: any[] = [];

            if (hasState) {
                listings = await listingService.getListingsByState(state, userId);
            } else if (hasCity) {
                listings = await listingService.getListingsByCity(city, userId);
            }

            if (hasState && hasCity) {
                listings = listings.filter(l => l.city && city.includes(l.city));
            }

            listingIds = listings.length > 0 ? listings.map(l => l.id) : listingId;
        }


        const baseWhere: any = {
            ...(status && status.length > 0 && { status: In(status) }),
            ...(listingIds && { listingId: In(listingIds) }),
            ...(role && role.length > 0 && { role: In(role) }),
            ...(paymentMethod && paymentMethod.length > 0 && { paymentMethod: In(paymentMethod) }),
            ...(isAutoPay !== undefined && { isAutoPay }),
            ...(name && { name: ILike(`%${name}%`) }),
            ...(contact && { contact: ILike(`%${contact}%`) }),
            ...(website_name && { website_name: ILike(`%${website_name}%`) }),
            ...(rate && { rate }),
            ...(source && source.length > 0 && { source: In(source) }),
            ...(email && { email }),
        };

        // Add keyword search for both name and contact (OR condition)
        const where = keyword
            ? [
                { ...baseWhere, name: ILike(`%${keyword}%`) },
                { ...baseWhere, contact: ILike(`%${keyword}%`) },
                { ...baseWhere, email: ILike(`%${keyword}%`) },
                { ...baseWhere, website_name: ILike(`%${keyword}%`) },
                { ...baseWhere, notes: ILike(`%${keyword}%`) }
            ]
            : baseWhere;


        const [data, total] = await this.contactRepo.findAndCount({
            where,
            skip: (page - 1) * limit,
            relations: ["contactUpdates"],
            take: limit,
            order: { name: "DESC" },
        });

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));     

        const tags = [tagIds.OWN, tagIds.ARB, tagIds.PM];
        const listingTags = await this.listingTagRepo
            .createQueryBuilder("t")
            .select([
                "DISTINCT t.tagId AS tagId",
                "t.name AS name",
                "l.id AS listingInfoId"
            ])
            .leftJoin("listing_info", "l", "t.listing_id = l.listing_id")
            .where("t.tagId IN (:...tags)", { tags })
            .getRawMany();

        const listingDetails = await this.listingDetailRepo.find();
        const listingSchedules = await this.listingScheduleRepo.find();

        const transformedData = data.map(d => {
            return {
                ...d,
                listingDetail: listingDetails.find(ld => ld.listingId == Number(d.listingId)) || null,
                listingSchedule: listingSchedules.filter(ls => ls.listingId == Number(d.listingId)) || null,
                listingName: listings.find((listing) => listing.id == Number(d.listingId))?.internalListingName,
                createdBy: userMap.get(d.createdBy) || d.createdBy,
                updatedBy: userMap.get(d.updatedBy) || d.updatedBy,
                propertyType: listingTags.find((tag) => tag.listingInfoId == d.listingId)?.name || "N/A",
                contactUpdates: d.contactUpdates.map(update => ({
                    ...update,
                    createdBy: userMap.get(update.createdBy) || update.createdBy,
                    updatedBy: userMap.get(update.updatedBy) || update.updatedBy
                })),
            };
        })

        return {
            contacts: transformedData,
            total
        };
    }

    async createContactRole(body: Partial<ContactRole>, userId: string) {
        const contactRole = this.contactRoleRepo.create({
            ...body,
            createdBy: userId,
        });
        return await this.contactRoleRepo.save(contactRole);
    }

    async updateContactRole(body: Partial<ContactRole>, userId: string) {
        const existingRole = await this.contactRoleRepo.findOneBy({ id: body.id });
        if (!existingRole) {
            throw CustomErrorHandler.notFound(`Contact Role with ID ${body.id} not found.`);
        }

        const updatedRole = this.contactRoleRepo.merge(existingRole, {
            ...body,
            updatedBy: userId,
        });

        return await this.contactRoleRepo.save(updatedRole);
    }

    async deleteContactRole(id: number, userId: string) {
        const contactRole = await this.contactRoleRepo.findOneBy({ id });
        if (!contactRole) {
            throw CustomErrorHandler.notFound(`Contact Role with ID ${id} not found.`);
        }

        contactRole.deletedBy = userId;
        await this.contactRoleRepo.save(contactRole);
        return await this.contactRoleRepo.softRemove(contactRole);
    }

    async getContactRoles() {
        const contactRoles = await this.contactRoleRepo.find();
        return contactRoles;
    }


    async createContactUpdates(body: any, userId: string) {
        const { contactId, updates } = body;

        const contact = await this.contactRepo.findOne({ where: { id: contactId } });
        if (!contact) {
            throw CustomErrorHandler.notFound(`Contact with ID ${contactId} not found`);
        }

        const newUpdate = this.contactUpdatesRepo.create({
            contact: contact,
            updates: updates,
            createdBy: userId,
        });

        const result = await this.contactUpdatesRepo.save(newUpdate);
        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));
        result.createdBy = userMap.get(result.createdBy) || result.createdBy;
        return result;
    }

    async updateContactUpdates(body: any, userId: string) {
        const { id, updates } = body;

        const existingContactUpdate = await this.contactUpdatesRepo.findOne({ where: { id } });
        if (!existingContactUpdate) {
            throw CustomErrorHandler.notFound(`Contact update with ID ${id} not found`);
        }
        existingContactUpdate.updates = updates;
        existingContactUpdate.updatedBy = userId;

        const result = await this.contactUpdatesRepo.save(existingContactUpdate);
        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));
        result.createdBy = userMap.get(result.createdBy) || result.createdBy;
        return result;
    }

    async deleteContactUpdates(id: number, userId: string) {
        const existingContactUpdate = await this.contactUpdatesRepo.findOne({ where: { id } });
        if (!existingContactUpdate) {
            throw CustomErrorHandler.notFound(`Contact update with ID ${id} not found`);
        }

        existingContactUpdate.deletedBy = userId;
        existingContactUpdate.deletedAt = new Date();

        return await this.contactUpdatesRepo.save(existingContactUpdate);
    }

    async bulkUpdateContacts(ids: number[], updateData: Partial<Contact>, userId: string) {
        try {
            // Validate that all contacts exist
            const existingContacts = await this.contactRepo.find({
                where: { id: In(ids) }
            });

            if (existingContacts.length !== ids.length) {
                const foundIds = existingContacts.map(contact => contact.id);
                const missingIds = ids.filter(id => !foundIds.includes(id));
                throw CustomErrorHandler.notFound(`Contacts with IDs ${missingIds.join(', ')} not found`);
            }

            // Update all contacts with the provided data
            const updatePromises = existingContacts.map(contact => {
                // Only update fields that are provided in updateData
                if (updateData.name !== undefined) {
                    contact.name = updateData.name;
                }
                if (updateData.contact !== undefined) {
                    contact.contact = updateData.contact;
                }
                if (updateData.email !== undefined) {
                    contact.email = updateData.email;
                }
                if (updateData.website_name !== undefined) {
                    contact.website_name = updateData.website_name;
                }
                if (updateData.website_link !== undefined) {
                    contact.website_link = updateData.website_link;
                }
                if (updateData.rate !== undefined) {
                    contact.rate = updateData.rate;
                }
                if (updateData.paymentMethod !== undefined) {
                    contact.paymentMethod = updateData.paymentMethod;
                }
                if (updateData.isAutoPay !== undefined) {
                    contact.isAutoPay = updateData.isAutoPay;
                }
                if (updateData.source !== undefined) {
                    contact.source = updateData.source;
                }
                if (updateData.status !== undefined) {
                    contact.status = updateData.status;
                }
                if (updateData.role !== undefined) {
                    contact.role = updateData.role;
                }
                if (updateData.listingId !== undefined) {
                    contact.listingId = updateData.listingId;
                }
                if (updateData.notes !== undefined) {
                    contact.notes = updateData.notes;
                }
                if (updateData.paymentDayOfWeek !== undefined) {
                    contact.paymentDayOfWeek = updateData.paymentDayOfWeek ? JSON.stringify(updateData.paymentDayOfWeek) : null;
                }
                if (updateData.paymentScheduleType !== undefined) {
                    contact.paymentScheduleType = updateData.paymentScheduleType;
                }
                if (updateData.paymentIntervalMonth !== undefined) {
                    contact.paymentIntervalMonth = updateData.paymentIntervalMonth;
                }
                if (updateData.paymentWeekOfMonth !== undefined) {
                    contact.paymentWeekOfMonth = updateData.paymentWeekOfMonth;
                }
                if (updateData.paymentDayOfMonth !== undefined) {
                    contact.paymentDayOfMonth = updateData.paymentDayOfMonth;
                }
                if (updateData.costRating !== undefined) {
                    contact.costRating = updateData.costRating;
                }
                if (updateData.trustLevel !== undefined) {
                    contact.trustLevel = updateData.trustLevel;
                }
                if (updateData.speed !== undefined) {
                    contact.speed = updateData.speed;
                }
                
                contact.updatedBy = userId;
                return this.contactRepo.save(contact);
            });

            const updatedContacts = await Promise.all(updatePromises);
            
            return {
                success: true,
                updatedCount: updatedContacts.length,
                message: `Successfully updated ${updatedContacts.length} contacts`
            };
        } catch (error) {
            throw error;
        }
    }

}
