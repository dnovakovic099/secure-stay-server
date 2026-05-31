import { appDatabase } from "../utils/database.util";
import { Contact } from "../entity/Contact";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ILike, In, Raw } from "typeorm";
import { ListingService } from "./ListingService";
import { UsersEntity } from "../entity/Users";
import { Listing } from "../entity/Listing";
import { ListingDetail } from "../entity/ListingDetails";
import { ContactRole } from "../entity/ContactRole";
import { ContactUpdates } from "../entity/ContactUpdates";
import { ListingSchedule } from "../entity/ListingSchedule";
import { VendorAssignment } from "../entity/VendorAssignment";

interface FilterQuery {
    page: number;
    limit: number;
    status?: string[];
    listingId?: string[];
    role?: string[];
    name?: string;
    contact?: string;
    website_name?: string[];
    rate?: string;
    rateOperator?: string;
    rateFrom?: string;
    rateTo?: string;
    paymentMethod?: string[];
    managedBy?: string[];
    workSchedule?: string[];
    paymentScheduleType?: string[];
    isAutoPay?: boolean;
    propertyType?: string[];
    serviceType?: string[];
    source?: string[];
    email?: string;
    keyword?: string;
    notesKeyword?: string;
    createdBy?: string[];
    updatedBy?: string[];
    createdOn?: string;
    updatedOn?: string;
    state?: string[];
    city?: string[];
    paidBy?: string[];
}

export class ContactService {
    private contactRepo = appDatabase.getRepository(Contact);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepository = appDatabase.getRepository(Listing);
    private listingDetailRepo = appDatabase.getRepository(ListingDetail);
    private contactRoleRepo = appDatabase.getRepository(ContactRole);
    private contactUpdatesRepo = appDatabase.getRepository(ContactUpdates);
    private listingScheduleRepo = appDatabase.getRepository(ListingSchedule);
    private vendorAssignmentRepo = appDatabase.getRepository(VendorAssignment);

    private getRoleAliases(role: Partial<ContactRole>) {
        return Array.from(new Set([
            role.role,
            role.workCategory
        ].filter((value): value is string => Boolean(value && value.trim()))));
    }

    private normalizeContactAuditValue(value: any): string | null {
        if (value === undefined || value === null || value === '') return null;
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && item !== '').join(', ') || null;
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    private getContactAuditChanges(existing: Contact, next: Partial<Contact>) {
        const fields: Array<{ key: keyof Contact; label: string; nextValue?: any }> = [
            { key: 'status', label: 'Status', nextValue: next.status },
            { key: 'listingId', label: 'Property', nextValue: next.listingId },
            { key: 'role', label: 'Role', nextValue: next.role },
            { key: 'name', label: 'Vendor Name', nextValue: next.name },
            { key: 'contact', label: 'Phone Number', nextValue: next.contact },
            { key: 'email', label: 'Email', nextValue: next.email },
            { key: 'source', label: 'Source', nextValue: next.source },
            { key: 'notes', label: 'Notes', nextValue: next.notes },
            { key: 'website_name', label: 'Website Name', nextValue: next.website_name },
            { key: 'website_link', label: 'Website Link', nextValue: next.website_link },
            { key: 'rate', label: 'Rate', nextValue: next.rate },
            { key: 'managedBy', label: 'Managed By', nextValue: next.managedBy },
            { key: 'workSchedule', label: 'Work Schedule', nextValue: next.workSchedule },
            { key: 'paymentScheduleType', label: 'Payment Schedule', nextValue: next.paymentScheduleType },
            { key: 'paymentMethod', label: 'Payment Method', nextValue: next.paymentMethod },
            { key: 'isAutoPay', label: 'Auto Pay', nextValue: next.isAutoPay },
            { key: 'costRating', label: 'Cost Rating', nextValue: next.costRating },
            { key: 'trustLevel', label: 'Trust Level', nextValue: next.trustLevel },
            { key: 'speed', label: 'Speed', nextValue: next.speed },
            { key: 'paidBy', label: 'Paid By', nextValue: next.paidBy },
            { key: 'payoutDetails', label: 'Payout Details', nextValue: next.payoutDetails },
            { key: 'paymentIntervalMonth', label: 'Payment Interval Month', nextValue: next.paymentIntervalMonth },
            { key: 'paymentDayOfWeek', label: 'Payment Day Of Week', nextValue: next.paymentDayOfWeek },
            { key: 'paymentWeekOfMonth', label: 'Payment Week Of Month', nextValue: next.paymentWeekOfMonth },
            { key: 'paymentDayOfMonth', label: 'Payment Day Of Month', nextValue: next.paymentDayOfMonth },
        ];

        return fields.flatMap(({ key, label, nextValue }) => {
            if (nextValue === undefined) return [];
            const previous = this.normalizeContactAuditValue((existing as any)[key]);
            const nextNormalized = this.normalizeContactAuditValue(nextValue);
            if (previous === nextNormalized) return [];
            return [{ label, oldValue: previous, newValue: nextNormalized }];
        });
    }

    private async createContactChangeUpdate(contact: Contact, changes: Array<{ label: string; oldValue: string | null; newValue: string | null }>, userId: string) {
        if (!changes.length) return;
        const update = this.contactUpdatesRepo.create({
            contact,
            updates: changes.map((change) => `${change.label}: ${change.oldValue || '—'} → ${change.newValue || '—'}`).join('\n'),
            createdBy: userId,
            updatedBy: userId,
        });
        await this.contactUpdatesRepo.save(update);
    }

    async createContact(body: Partial<Contact>, userId: string) {
        // Validate active cleaner constraint
        if (body.role === 'Cleaner' && body.status === 'active') {
            const existingActiveCleaner = await this.contactRepo.findOne({
                where: {
                    listingId: body.listingId,
                    role: 'Cleaner',
                    status: 'active',
                    deletedAt: null as any
                }
            });

            if (existingActiveCleaner) {
                throw CustomErrorHandler.validationError(
                    "An active cleaner already exists for this listing. Please change the current active cleaner to 'active-backup' or 'inactive' first."
                );
            }
        }

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

        // Validate active cleaner constraint when changing to active
        if (body.role === 'Cleaner' && body.status === 'active' && existing.status !== 'active') {
            const existingActiveCleaner = await this.contactRepo.findOne({
                where: {
                    listingId: body.listingId || existing.listingId,
                    role: 'Cleaner',
                    status: 'active',
                    deletedAt: null as any
                }
            });

            if (existingActiveCleaner && existingActiveCleaner.id !== existing.id) {
                throw CustomErrorHandler.validationError(
                    "An active cleaner already exists for this listing. Please change the current active cleaner to 'active-backup' or 'inactive' first."
                );
            }
        }

        const nextValues = {
            ...body,
            updatedBy: userId,
        };
        if (body.paymentDayOfWeek !== undefined) {
            (nextValues as Partial<Contact>).paymentDayOfWeek = body.paymentDayOfWeek ? JSON.stringify(body.paymentDayOfWeek) : null;
        }
        const changes = this.getContactAuditChanges(existing, nextValues);
        const updated = this.contactRepo.merge(existing, nextValues);

        const saved = await this.contactRepo.save(updated);
        await this.createContactChangeUpdate(saved, changes, userId);
        return saved;
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
            rateOperator,
            rateFrom,
            rateTo,
            paymentMethod,
            managedBy,
            workSchedule,
            paymentScheduleType,
            isAutoPay,
            propertyType,
            serviceType,
            source,
            email,
            keyword,
            notesKeyword,
            createdBy,
            updatedBy,
            createdOn,
            updatedOn,
            state,
            city,
            paidBy
        } = query;

        let listingIds: any[] | undefined = undefined;
        const listingService = new ListingService();
        const listings = await listingService.getListingNames(userId);
        
        const hasPropertyType = propertyType && propertyType.length > 0;
        const hasServiceType = serviceType && serviceType.length > 0;
        const hasState = state && state.length > 0;
        const hasCity = city && city.length > 0;

        if (hasPropertyType || hasServiceType) {
            let filteredListings = hasPropertyType
                ? await listingService.getListingsByPropertyTypes(propertyType as any, userId)
                : listings;

            if (hasServiceType) {
                const serviceListings = await listingService.getListingsByServiceTypes(serviceType as any, userId);
                const serviceListingIds = new Set(serviceListings.map(l => Number(l.id)));
                filteredListings = filteredListings.filter(l => serviceListingIds.has(Number(l.id)));
            }

            if (hasState) {
                filteredListings = filteredListings.filter(l => l.state && state.includes(l.state));
            }

            if (hasCity) {
                filteredListings = filteredListings.filter(l => l.city && city.includes(l.city));
            }

            listingIds = filteredListings.map(l => l.id);
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

        if (listingId && listingId.length > 0) {
            listingIds = listingIds && listingIds.length > 0
                ? listingIds.filter(id => listingId.map(String).includes(String(id)))
                : listingId;
        }

        const rateFilter = (() => {
            const operator = rateOperator || 'equal';
            if (operator === 'between' && (rateFrom || rateTo)) {
                const min = Number(rateFrom || 0);
                const max = Number(rateTo || Number.MAX_SAFE_INTEGER);
                return Raw((alias) => `CAST(${alias} AS DECIMAL(10,2)) BETWEEN :minRate AND :maxRate`, { minRate: min, maxRate: max });
            }
            if (!rate) return undefined;
            const numericRate = Number(rate);
            if (Number.isNaN(numericRate)) return rate;
            if (operator === 'moreThan') return Raw((alias) => `CAST(${alias} AS DECIMAL(10,2)) > :rate`, { rate: numericRate });
            if (operator === 'lessThan') return Raw((alias) => `CAST(${alias} AS DECIMAL(10,2)) < :rate`, { rate: numericRate });
            return Raw((alias) => `CAST(${alias} AS DECIMAL(10,2)) = :rate`, { rate: numericRate });
        })();

        const baseWhere: any = {
            ...(status && status.length > 0 && { status: In(status) }),
            ...(listingIds && { listingId: In(listingIds) }),
            ...(role && role.length > 0 && { role: In(role) }),
            ...(paymentMethod && paymentMethod.length > 0 && { paymentMethod: In(paymentMethod) }),
            ...(managedBy && managedBy.length > 0 && { managedBy: In(managedBy) }),
            ...(workSchedule && workSchedule.length > 0 && { workSchedule: In(workSchedule) }),
            ...(paymentScheduleType && paymentScheduleType.length > 0 && { paymentScheduleType: In(paymentScheduleType) }),
            ...(isAutoPay !== undefined && { isAutoPay }),
            ...(name && { name: ILike(`%${name}%`) }),
            ...(contact && { contact: ILike(`%${contact}%`) }),
            ...(website_name && website_name.length > 0 && { website_name: In(website_name) }),
            ...(rateFilter && { rate: rateFilter }),
            ...(source && source.length > 0 && { source: In(source) }),
            ...(email && { email }),
            ...(notesKeyword && { notes: ILike(`%${notesKeyword}%`) }),
            ...(createdBy && createdBy.length > 0 && { createdBy: In(createdBy) }),
            ...(updatedBy && updatedBy.length > 0 && { updatedBy: In(updatedBy) }),
            ...(createdOn && { createdAt: Raw((alias) => `DATE(${alias}) = :createdOn`, { createdOn }) }),
            ...(updatedOn && { updatedAt: Raw((alias) => `DATE(${alias}) = :updatedOn`, { updatedOn }) }),
            ...(paidBy && paidBy.length > 0 && { paidBy: In(paidBy) }),
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


        const listingDetails = await this.listingDetailRepo.find();
        const listingSchedules = await this.listingScheduleRepo.find();

        const transformedData = data.map(d => {
            const listingMeta = listings.find((listing) => listing.id == Number(d.listingId));
            return {
                ...d,
                listingDetail: listingDetails.find(ld => ld.listingId == Number(d.listingId)) || null,
                listingSchedule: listingSchedules.filter(ls => ls.listingId == Number(d.listingId)) || null,
                listingName: listingMeta?.internalListingName,
                tags: listingMeta?.tags,
                propertyType: listingMeta?.propertyType,
                createdById: d.createdBy,
                updatedById: d.updatedBy,
                createdBy: userMap.get(d.createdBy) || d.createdBy,
                updatedBy: userMap.get(d.updatedBy) || d.updatedBy,
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

    async updateContactRole(body: Partial<ContactRole> & { updateVendorAssignments?: boolean }, userId: string) {
        const existingRole = await this.contactRoleRepo.findOneBy({ id: body.id });
        if (!existingRole) {
            throw CustomErrorHandler.notFound(`Contact Role with ID ${body.id} not found.`);
        }

        const previousAliases = this.getRoleAliases(existingRole);
        const nextRoleName = body.role || body.workCategory;
        const updatedRole = this.contactRoleRepo.merge(existingRole, {
            ...body,
            updatedBy: userId,
        });

        const savedRole = await this.contactRoleRepo.save(updatedRole);

        if (nextRoleName && previousAliases.length > 0 && !previousAliases.includes(nextRoleName)) {
            await this.contactRepo.update(
                { role: In(previousAliases) },
                { role: nextRoleName, updatedBy: userId }
            );
            if (body.updateVendorAssignments !== false) {
                await this.vendorAssignmentRepo.update(
                    { role: In(previousAliases) },
                    { role: nextRoleName, updatedBy: userId }
                );
            }
        }

        return savedRole;
    }

    async deleteContactRole(id: number, userId: string, options?: { replacementRole?: string; role?: string; workCategory?: string; }) {
        const contactRole = await this.contactRoleRepo.findOneBy({ id });
        if (!contactRole) {
            throw CustomErrorHandler.notFound(`Contact Role with ID ${id} not found.`);
        }

        const roleAliases = this.getRoleAliases({
            role: options?.role || contactRole.role,
            workCategory: options?.workCategory || contactRole.workCategory
        });

        if (roleAliases.length > 0 && !options?.replacementRole) {
            const [contactCount, vendorAssignmentCount] = await Promise.all([
                this.contactRepo.count({ where: { role: In(roleAliases) } }),
                this.vendorAssignmentRepo.count({ where: { role: In(roleAliases) } })
            ]);
            if (contactCount + vendorAssignmentCount > 0) {
                throw CustomErrorHandler.validationError("Choose a replacement role before deleting a role that is used by existing vendors.");
            }
        }

        if (options?.replacementRole && roleAliases.length > 0) {
            await this.contactRepo.update(
                { role: In(roleAliases) },
                { role: options.replacementRole, updatedBy: userId }
            );
            await this.vendorAssignmentRepo.update(
                { role: In(roleAliases) },
                { role: options.replacementRole, updatedBy: userId }
            );
        }

        contactRole.deletedBy = userId;
        await this.contactRoleRepo.save(contactRole);
        return await this.contactRoleRepo.softRemove(contactRole);
    }

    async getContactRoles() {
        const contactRoles = await this.contactRoleRepo.find();
        return await Promise.all(contactRoles.map(async (role) => {
            const aliases = this.getRoleAliases(role);
            const contactCount = aliases.length
                ? await this.contactRepo.count({ where: { role: In(aliases) } })
                : 0;
            const vendorAssignmentCount = aliases.length
                ? await this.vendorAssignmentRepo.count({ where: { role: In(aliases) } })
                : 0;
            return {
                ...role,
                contactCount,
                vendorAssignmentCount,
                usageCount: contactCount + vendorAssignmentCount
            };
        }));
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
            const updatePromises = existingContacts.map(async contact => {
                const originalContact = { ...contact } as Contact;
                const auditPayload: Partial<Contact> = {};
                // Only update fields that are provided in updateData
                if (updateData.name !== undefined) {
                    auditPayload.name = updateData.name;
                    contact.name = updateData.name;
                }
                if (updateData.contact !== undefined) {
                    auditPayload.contact = updateData.contact;
                    contact.contact = updateData.contact;
                }
                if (updateData.email !== undefined) {
                    auditPayload.email = updateData.email;
                    contact.email = updateData.email;
                }
                if (updateData.website_name !== undefined) {
                    auditPayload.website_name = updateData.website_name;
                    contact.website_name = updateData.website_name;
                }
                if (updateData.website_link !== undefined) {
                    auditPayload.website_link = updateData.website_link;
                    contact.website_link = updateData.website_link;
                }
                if (updateData.rate !== undefined) {
                    auditPayload.rate = updateData.rate;
                    contact.rate = updateData.rate;
                }
                if (updateData.managedBy !== undefined) {
                    auditPayload.managedBy = updateData.managedBy;
                    contact.managedBy = updateData.managedBy;
                }
                if (updateData.workSchedule !== undefined) {
                    auditPayload.workSchedule = updateData.workSchedule;
                    contact.workSchedule = updateData.workSchedule;
                }
                if (updateData.paymentMethod !== undefined) {
                    auditPayload.paymentMethod = updateData.paymentMethod;
                    contact.paymentMethod = updateData.paymentMethod;
                }
                if (updateData.isAutoPay !== undefined) {
                    auditPayload.isAutoPay = updateData.isAutoPay;
                    contact.isAutoPay = updateData.isAutoPay;
                }
                if (updateData.source !== undefined) {
                    auditPayload.source = updateData.source;
                    contact.source = updateData.source;
                }
                if (updateData.status !== undefined) {
                    auditPayload.status = updateData.status;
                    contact.status = updateData.status;
                }
                if (updateData.role !== undefined) {
                    auditPayload.role = updateData.role;
                    contact.role = updateData.role;
                }
                if (updateData.listingId !== undefined) {
                    auditPayload.listingId = updateData.listingId;
                    contact.listingId = updateData.listingId;
                }
                if (updateData.notes !== undefined) {
                    auditPayload.notes = updateData.notes;
                    contact.notes = updateData.notes;
                }
                if (updateData.paymentDayOfWeek !== undefined) {
                    auditPayload.paymentDayOfWeek = updateData.paymentDayOfWeek ? JSON.stringify(updateData.paymentDayOfWeek) : null;
                    contact.paymentDayOfWeek = auditPayload.paymentDayOfWeek;
                }
                if (updateData.paymentScheduleType !== undefined) {
                    auditPayload.paymentScheduleType = updateData.paymentScheduleType;
                    contact.paymentScheduleType = updateData.paymentScheduleType;
                }
                if (updateData.paymentIntervalMonth !== undefined) {
                    auditPayload.paymentIntervalMonth = updateData.paymentIntervalMonth;
                    contact.paymentIntervalMonth = updateData.paymentIntervalMonth;
                }
                if (updateData.paymentWeekOfMonth !== undefined) {
                    auditPayload.paymentWeekOfMonth = updateData.paymentWeekOfMonth;
                    contact.paymentWeekOfMonth = updateData.paymentWeekOfMonth;
                }
                if (updateData.paymentDayOfMonth !== undefined) {
                    auditPayload.paymentDayOfMonth = updateData.paymentDayOfMonth;
                    contact.paymentDayOfMonth = updateData.paymentDayOfMonth;
                }
                if (updateData.costRating !== undefined) {
                    auditPayload.costRating = updateData.costRating;
                    contact.costRating = updateData.costRating;
                }
                if (updateData.trustLevel !== undefined) {
                    auditPayload.trustLevel = updateData.trustLevel;
                    contact.trustLevel = updateData.trustLevel;
                }
                if (updateData.speed !== undefined) {
                    auditPayload.speed = updateData.speed;
                    contact.speed = updateData.speed;
                }
                if(updateData.paidBy !== undefined) {
                    auditPayload.paidBy = updateData.paidBy;
                    contact.paidBy = updateData.paidBy;
                }
                if (updateData.payoutDetails !== undefined) {
                    auditPayload.payoutDetails = updateData.payoutDetails;
                    contact.payoutDetails = updateData.payoutDetails;
                }
                
                const changes = this.getContactAuditChanges(originalContact, auditPayload);
                contact.updatedBy = userId;
                const saved = await this.contactRepo.save(contact);
                await this.createContactChangeUpdate(saved, changes, userId);
                return saved;
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


    async getContactList(keyword: string) {
        const contacts = await this.contactRepo
            .createQueryBuilder("contact")
            .select([
                "MIN(contact.id) as id",
                "contact.name as name",
                "contact.contact as contact",
                "contact.email as email"
            ])
            .where("contact.name LIKE :keyword", { keyword: `${keyword}%` })
            .groupBy("contact.contact") // distinct on contact
            .orderBy("name", "DESC")
            .getRawMany();

        return contacts;
    }

    /**
     * Get all cleaners for a specific listing
     */
    async getCleanersByListing(listingId: string) {
        return await this.contactRepo.find({
            where: {
                listingId,
                role: 'Cleaner',
                deletedAt: null as any
            },
            order: {
                status: 'ASC', // Active first
                name: 'ASC'
            }
        });
    }

    /**
     * Get the primary (active) cleaner for a listing
     */
    async getPrimaryCleanerForListing(listingId: string) {
        return await this.contactRepo.findOne({
            where: {
                listingId,
                role: 'Cleaner',
                status: 'active',
                deletedAt: null as any
            }
        });
    }

}
