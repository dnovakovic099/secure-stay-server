import { ILike, In } from "typeorm";
import CustomErrorHandler from "../middleware/customError.middleware";
import { Contact } from "../entity/Contact";
import { Listing } from "../entity/Listing";
import { ListingDetail } from "../entity/ListingDetails";
import { ListingSchedule } from "../entity/ListingSchedule";
import { UsersEntity } from "../entity/Users";
import { VendorAssignment } from "../entity/VendorAssignment";
import { VendorAssignmentUpdate } from "../entity/VendorAssignmentUpdate";
import { VendorProfile } from "../entity/VendorProfile";
import { VendorProfileUpdate } from "../entity/VendorProfileUpdate";
import { appDatabase } from "../utils/database.util";
import { ListingService } from "./ListingService";

type VendorProfilePayload = Partial<VendorProfile> & {
    assignments?: Array<Partial<VendorAssignment>>;
};

type VendorAssignmentPayload = Partial<VendorAssignment> & {
    copyFromAssignmentId?: number;
};

export class VendorProfileService {
    private vendorProfileRepo = appDatabase.getRepository(VendorProfile);
    private vendorAssignmentRepo = appDatabase.getRepository(VendorAssignment);
    private vendorProfileUpdateRepo = appDatabase.getRepository(VendorProfileUpdate);
    private vendorAssignmentUpdateRepo = appDatabase.getRepository(VendorAssignmentUpdate);
    private contactRepo = appDatabase.getRepository(Contact);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private listingDetailRepo = appDatabase.getRepository(ListingDetail);
    private listingScheduleRepo = appDatabase.getRepository(ListingSchedule);
    private static schemaReady = false;

    private async ensureVendorSchema() {
        if (VendorProfileService.schemaReady) return;

        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS vendor_profiles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                contact VARCHAR(100) NULL,
                email VARCHAR(255) NULL,
                source VARCHAR(100) NULL,
                notes TEXT NULL,
                avatarUrl VARCHAR(2048) NULL,
                icon VARCHAR(100) NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deletedAt TIMESTAMP NULL,
                createdBy VARCHAR(255) NULL,
                updatedBy VARCHAR(255) NULL,
                deletedBy VARCHAR(255) NULL,
                INDEX idx_vendor_profiles_contact (contact),
                INDEX idx_vendor_profiles_email (email),
                INDEX idx_vendor_profiles_deletedAt (deletedAt)
            )
        `);

        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS vendor_assignments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vendorProfileId INT NOT NULL,
                listingId VARCHAR(100) NOT NULL,
                role VARCHAR(255) NULL,
                status VARCHAR(50) NULL,
                managedBy VARCHAR(100) NULL,
                workSchedule VARCHAR(100) NULL,
                paymentScheduleType VARCHAR(100) NULL,
                paymentMethod VARCHAR(100) NULL,
                isAutoPay BOOLEAN DEFAULT FALSE,
                paidBy VARCHAR(100) NULL,
                rate VARCHAR(100) NULL,
                rateType VARCHAR(100) NULL,
                customRateDescription VARCHAR(255) NULL,
                workScheduleDays VARCHAR(255) NULL,
                workScheduleIntervalWeeks INT NULL,
                workScheduleDayOfMonth INT NULL,
                workScheduleQuarter VARCHAR(50) NULL,
                workScheduleMonth VARCHAR(50) NULL,
                workScheduleCheckoutTiming VARCHAR(100) NULL,
                trustLevel INT NULL,
                speed INT NULL,
                costRating INT NULL,
                website_name VARCHAR(255) NULL,
                website_link VARCHAR(2048) NULL,
                notes TEXT NULL,
                payoutDetails TEXT NULL,
                paymentIntervalMonth INT NULL,
                paymentDayOfWeek VARCHAR(255) NULL,
                paymentWeekOfMonth INT NULL,
                paymentDayOfMonth INT NULL,
                nextServiceDate TIMESTAMP NULL,
                legacyContactId INT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deletedAt TIMESTAMP NULL,
                createdBy VARCHAR(255) NULL,
                updatedBy VARCHAR(255) NULL,
                deletedBy VARCHAR(255) NULL,
                CONSTRAINT fk_vendor_assignments_profile FOREIGN KEY (vendorProfileId) REFERENCES vendor_profiles(id) ON DELETE CASCADE,
                UNIQUE KEY uniq_vendor_assignment_legacy_contact (legacyContactId),
                INDEX idx_vendor_assignments_profile (vendorProfileId),
                INDEX idx_vendor_assignments_listing (listingId),
                INDEX idx_vendor_assignments_status (status),
                INDEX idx_vendor_assignments_deletedAt (deletedAt)
            )
        `);

        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS vendor_profile_updates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vendorProfileId INT NOT NULL,
                updates TEXT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deletedAt TIMESTAMP NULL,
                createdBy VARCHAR(255) NULL,
                updatedBy VARCHAR(255) NULL,
                deletedBy VARCHAR(255) NULL,
                CONSTRAINT fk_vendor_profile_updates_profile FOREIGN KEY (vendorProfileId) REFERENCES vendor_profiles(id) ON DELETE CASCADE,
                INDEX idx_vendor_profile_updates_profile (vendorProfileId),
                INDEX idx_vendor_profile_updates_deletedAt (deletedAt)
            )
        `);

        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS vendor_assignment_updates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vendorAssignmentId INT NOT NULL,
                updates TEXT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deletedAt TIMESTAMP NULL,
                createdBy VARCHAR(255) NULL,
                updatedBy VARCHAR(255) NULL,
                deletedBy VARCHAR(255) NULL,
                CONSTRAINT fk_vendor_assignment_updates_assignment FOREIGN KEY (vendorAssignmentId) REFERENCES vendor_assignments(id) ON DELETE CASCADE,
                INDEX idx_vendor_assignment_updates_assignment (vendorAssignmentId),
                INDEX idx_vendor_assignment_updates_deletedAt (deletedAt)
            )
        `);

        VendorProfileService.schemaReady = true;
    }

    private normalizeIdentity(value: any) {
        return String(value || "").trim().toLowerCase();
    }

    private getLegacyVendorKey(contact: Contact) {
        return (
            this.normalizeIdentity(contact.contact) ||
            this.normalizeIdentity(contact.email) ||
            this.normalizeIdentity(contact.name) ||
            `legacy-contact-${contact.id}`
        );
    }

    private normalizeAuditValue(value: any): string | null {
        if (value === undefined || value === null || value === "") return null;
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) return value.filter(Boolean).join(", ") || null;
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
    }

    private getProfileAuditChanges(existing: VendorProfile, next: Partial<VendorProfile>) {
        const fields: Array<{ key: keyof VendorProfile; label: string; nextValue?: any }> = [
            { key: "name", label: "Vendor Name", nextValue: next.name },
            { key: "contact", label: "Phone Number", nextValue: next.contact },
            { key: "email", label: "Email", nextValue: next.email },
            { key: "source", label: "Source", nextValue: next.source },
            { key: "notes", label: "General Notes", nextValue: next.notes },
            { key: "avatarUrl", label: "Avatar", nextValue: next.avatarUrl },
            { key: "icon", label: "Icon", nextValue: next.icon },
        ];

        return fields.flatMap(({ key, label, nextValue }) => {
            if (nextValue === undefined) return [];
            const oldValue = this.normalizeAuditValue((existing as any)[key]);
            const newValue = this.normalizeAuditValue(nextValue);
            if (oldValue === newValue) return [];
            return [{ label, oldValue, newValue }];
        });
    }

    private getAssignmentAuditChanges(existing: VendorAssignment, next: Partial<VendorAssignment>) {
        const fields: Array<{ key: keyof VendorAssignment; label: string; nextValue?: any }> = [
            { key: "listingId", label: "Property", nextValue: next.listingId },
            { key: "role", label: "Role", nextValue: next.role },
            { key: "status", label: "Assignment Status", nextValue: next.status },
            { key: "managedBy", label: "Managed By", nextValue: next.managedBy },
            { key: "workSchedule", label: "Work Schedule", nextValue: next.workSchedule },
            { key: "workScheduleDays", label: "Work Schedule Days", nextValue: next.workScheduleDays },
            { key: "workScheduleIntervalWeeks", label: "Work Schedule Interval", nextValue: next.workScheduleIntervalWeeks },
            { key: "workScheduleDayOfMonth", label: "Work Schedule Day Of Month", nextValue: next.workScheduleDayOfMonth },
            { key: "workScheduleQuarter", label: "Work Schedule Quarter", nextValue: next.workScheduleQuarter },
            { key: "workScheduleMonth", label: "Work Schedule Month", nextValue: next.workScheduleMonth },
            { key: "workScheduleCheckoutTiming", label: "Checkout Timing", nextValue: next.workScheduleCheckoutTiming },
            { key: "rate", label: "Rate", nextValue: next.rate },
            { key: "rateType", label: "Rate Type", nextValue: next.rateType },
            { key: "customRateDescription", label: "Custom Rate Description", nextValue: next.customRateDescription },
            { key: "paymentMethod", label: "Payment Method", nextValue: next.paymentMethod },
            { key: "paymentScheduleType", label: "Payment Schedule", nextValue: next.paymentScheduleType },
            { key: "paidBy", label: "Paid By", nextValue: next.paidBy },
            { key: "trustLevel", label: "Trust Level", nextValue: next.trustLevel },
            { key: "speed", label: "Speed", nextValue: next.speed },
            { key: "costRating", label: "Cost Rating", nextValue: next.costRating },
            { key: "website_name", label: "Website Name", nextValue: next.website_name },
            { key: "website_link", label: "Website Link", nextValue: next.website_link },
            { key: "notes", label: "Assignment Notes", nextValue: next.notes },
            { key: "nextServiceDate", label: "Next Service Date", nextValue: next.nextServiceDate },
            { key: "payoutDetails", label: "Payout Details", nextValue: next.payoutDetails },
            { key: "paymentIntervalMonth", label: "Payment Interval Month", nextValue: next.paymentIntervalMonth },
            { key: "paymentDayOfWeek", label: "Payment Day Of Week", nextValue: next.paymentDayOfWeek },
            { key: "paymentWeekOfMonth", label: "Payment Week Of Month", nextValue: next.paymentWeekOfMonth },
            { key: "paymentDayOfMonth", label: "Payment Day Of Month", nextValue: next.paymentDayOfMonth },
        ];

        return fields.flatMap(({ key, label, nextValue }) => {
            if (nextValue === undefined) return [];
            const oldValue = this.normalizeAuditValue((existing as any)[key]);
            const newValue = this.normalizeAuditValue(nextValue);
            if (oldValue === newValue) return [];
            return [{ label, oldValue, newValue }];
        });
    }

    private async createProfileChangeUpdate(profile: VendorProfile, changes: Array<{ label: string; oldValue: string | null; newValue: string | null }>, userId: string) {
        if (!changes.length) return;
        await this.vendorProfileUpdateRepo.save(this.vendorProfileUpdateRepo.create({
            vendorProfile: profile,
            vendorProfileId: profile.id,
            updates: changes.map((change) => `${change.label}: ${change.oldValue || "—"} → ${change.newValue || "—"}`).join("\n"),
            createdBy: userId,
            updatedBy: userId,
        }));
    }

    private async createAssignmentChangeUpdate(assignment: VendorAssignment, changes: Array<{ label: string; oldValue: string | null; newValue: string | null }>, userId: string) {
        if (!changes.length) return;
        await this.vendorAssignmentUpdateRepo.save(this.vendorAssignmentUpdateRepo.create({
            assignment,
            vendorAssignmentId: assignment.id,
            updates: changes.map((change) => `${change.label}: ${change.oldValue || "—"} → ${change.newValue || "—"}`).join("\n"),
            createdBy: userId,
            updatedBy: userId,
        }));
    }

    private async getUserMap() {
        const users = await this.usersRepo.find();
        return new Map(users.map(user => [user.uid, `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.uid]));
    }

    private async getListingMeta(userId: string) {
        const listingService = new ListingService();
        const listings = await listingService.getListingNames(userId);
        const listingDetails = await this.listingDetailRepo.find();
        const listingSchedules = await this.listingScheduleRepo.find();
        const listingById = new Map(listings.map((listing: any) => [String(listing.id), listing]));
        const detailsById = new Map(listingDetails.map(detail => [String(detail.listingId), detail]));
        const schedulesById = new Map<string, ListingSchedule[]>();
        listingSchedules.forEach(schedule => {
            const key = String(schedule.listingId);
            schedulesById.set(key, [...(schedulesById.get(key) || []), schedule]);
        });
        return { listingById, detailsById, schedulesById };
    }

    private hydrateAssignment(assignment: VendorAssignment, listingMeta: Awaited<ReturnType<VendorProfileService["getListingMeta"]>>, userMap: Map<string, string>) {
        const listing = listingMeta.listingById.get(String(assignment.listingId));
        return {
            ...assignment,
            listingName: listing?.internalListingName || listing?.name,
            internalListingName: listing?.internalListingName,
            tags: listing?.tags,
            propertyType: listing?.propertyType,
            serviceType: listing?.serviceType,
            serviceInfo: listing?.serviceInfo,
            clientServiceType: listing?.clientServiceType,
            managementServiceType: listing?.managementServiceType,
            listingDetail: listingMeta.detailsById.get(String(assignment.listingId)) || null,
            listingSchedule: listingMeta.schedulesById.get(String(assignment.listingId)) || [],
            createdById: assignment.createdBy,
            updatedById: assignment.updatedBy,
            createdBy: assignment.createdBy ? userMap.get(assignment.createdBy) || assignment.createdBy : assignment.createdBy,
            updatedBy: assignment.updatedBy ? userMap.get(assignment.updatedBy) || assignment.updatedBy : assignment.updatedBy,
            updates: (assignment.updates || []).map(update => ({
                ...update,
                createdBy: update.createdBy ? userMap.get(update.createdBy) || update.createdBy : update.createdBy,
                updatedBy: update.updatedBy ? userMap.get(update.updatedBy) || update.updatedBy : update.updatedBy,
            })),
        };
    }

    private async hydrateProfile(profile: VendorProfile, userId: string) {
        const [userMap, listingMeta] = await Promise.all([this.getUserMap(), this.getListingMeta(userId)]);
        const assignments = (profile.assignments || [])
            .filter(assignment => !assignment.deletedAt)
            .map(assignment => this.hydrateAssignment(assignment, listingMeta, userMap));
        const statuses = assignments.map((assignment: any) => String(assignment.status || "").trim()).filter(Boolean);
        const activeCount = statuses.filter(status => status === "active").length;
        const profileStatus = activeCount > 0 ? "active" : statuses[0] || "inactive";

        return {
            ...profile,
            status: profileStatus,
            assignmentCount: assignments.length,
            activeAssignmentCount: activeCount,
            createdById: profile.createdBy,
            updatedById: profile.updatedBy,
            createdBy: profile.createdBy ? userMap.get(profile.createdBy) || profile.createdBy : profile.createdBy,
            updatedBy: profile.updatedBy ? userMap.get(profile.updatedBy) || profile.updatedBy : profile.updatedBy,
            updates: (profile.updates || []).map(update => ({
                ...update,
                createdBy: update.createdBy ? userMap.get(update.createdBy) || update.createdBy : update.createdBy,
                updatedBy: update.updatedBy ? userMap.get(update.updatedBy) || update.updatedBy : update.updatedBy,
            })),
            assignments,
        };
    }

    private async ensureLegacyBackfill(userId: string) {
        await this.ensureVendorSchema();
        const existingProfiles = await this.vendorProfileRepo.count();
        if (existingProfiles > 0) return;

        const contacts = await this.contactRepo.find({ relations: ["contactUpdates"] });
        const groups = new Map<string, Contact[]>();
        contacts.filter(contact => !contact.deletedAt).forEach(contact => {
            const key = this.getLegacyVendorKey(contact);
            groups.set(key, [...(groups.get(key) || []), contact]);
        });

        await appDatabase.transaction(async manager => {
            const profileRepo = manager.getRepository(VendorProfile);
            const assignmentRepo = manager.getRepository(VendorAssignment);
            const profileUpdateRepo = manager.getRepository(VendorProfileUpdate);
            const assignmentUpdateRepo = manager.getRepository(VendorAssignmentUpdate);

            for (const group of groups.values()) {
                const [first] = group;
                const profile = await profileRepo.save(profileRepo.create({
                    name: first.name,
                    contact: first.contact || null,
                    email: first.email || null,
                    source: first.source || null,
                    notes: null,
                    createdBy: first.createdBy || userId,
                    updatedBy: first.updatedBy || userId,
                    createdAt: first.createdAt,
                    updatedAt: first.updatedAt,
                }));

                for (const contact of group) {
                    const assignment = await assignmentRepo.save(assignmentRepo.create({
                        vendorProfileId: profile.id,
                        vendorProfile: profile,
                        listingId: String(contact.listingId),
                        role: contact.role || null,
                        status: contact.status || null,
                        managedBy: contact.managedBy || null,
                        workSchedule: contact.workSchedule || null,
                        paymentScheduleType: contact.paymentScheduleType || null,
                        paymentMethod: contact.paymentMethod || null,
                        isAutoPay: Boolean(contact.isAutoPay),
                        paidBy: contact.paidBy || null,
                        rate: contact.rate || null,
                        rateType: null,
                        customRateDescription: null,
                        trustLevel: contact.trustLevel || null,
                        speed: contact.speed || null,
                        costRating: contact.costRating || null,
                        website_name: contact.website_name || null,
                        website_link: contact.website_link || null,
                        notes: contact.notes || null,
                        payoutDetails: contact.payoutDetails || null,
                        paymentIntervalMonth: contact.paymentIntervalMonth || null,
                        paymentDayOfWeek: contact.paymentDayOfWeek || null,
                        paymentWeekOfMonth: contact.paymentWeekOfMonth || null,
                        paymentDayOfMonth: contact.paymentDayOfMonth || null,
                        legacyContactId: contact.id,
                        createdBy: contact.createdBy || userId,
                        updatedBy: contact.updatedBy || userId,
                        createdAt: contact.createdAt,
                        updatedAt: contact.updatedAt,
                    }));

                    for (const update of contact.contactUpdates || []) {
                        if (update.deletedAt) continue;
                        await assignmentUpdateRepo.save(assignmentUpdateRepo.create({
                            vendorAssignmentId: assignment.id,
                            assignment,
                            updates: update.updates,
                            createdBy: update.createdBy || userId,
                            updatedBy: update.updatedBy || update.createdBy || userId,
                            createdAt: update.createdAt,
                            updatedAt: update.updatedAt,
                        }));
                    }
                }

                await profileUpdateRepo.save(profileUpdateRepo.create({
                    vendorProfileId: profile.id,
                    vendorProfile: profile,
                    updates: `Vendor profile created from ${group.length} legacy contact assignment${group.length === 1 ? "" : "s"}.`,
                    createdBy: userId,
                    updatedBy: userId,
                }));
            }
        });
    }

    async getVendorProfiles(query: any, userId: string) {
        await this.ensureLegacyBackfill(userId);
        const page = Number(query.page || 1);
        const limit = Number(query.limit || 500);
        const keyword = String(query.keyword || query.name || "").trim();
        const where = keyword
            ? [
                { name: ILike(`%${keyword}%`) },
                { contact: ILike(`%${keyword}%`) },
                { email: ILike(`%${keyword}%`) },
            ]
            : {};

        const [profiles, total] = await this.vendorProfileRepo.findAndCount({
            where,
            relations: ["assignments", "assignments.updates", "updates"],
            order: { name: "ASC" },
            skip: (page - 1) * limit,
            take: limit,
        });

        const hydrated = await Promise.all(profiles.map(profile => this.hydrateProfile(profile, userId)));
        return { vendors: hydrated, total };
    }

    async getVendorProfile(id: number, userId: string) {
        await this.ensureLegacyBackfill(userId);
        const profile = await this.vendorProfileRepo.findOne({
            where: { id },
            relations: ["assignments", "assignments.updates", "updates"],
        });
        if (!profile) throw CustomErrorHandler.notFound(`Vendor profile with ID ${id} not found.`);
        return this.hydrateProfile(profile, userId);
    }

    async createVendorProfile(body: VendorProfilePayload, userId: string) {
        await this.ensureVendorSchema();
        const profileId = await appDatabase.transaction(async manager => {
            const profileRepo = manager.getRepository(VendorProfile);
            const assignmentRepo = manager.getRepository(VendorAssignment);

            const profile = await profileRepo.save(profileRepo.create({
                name: body.name,
                contact: body.contact || null,
                email: body.email || null,
                source: body.source || null,
                notes: body.notes || null,
                avatarUrl: body.avatarUrl || null,
                icon: body.icon || null,
                createdBy: userId,
                updatedBy: userId,
            }));

            for (const assignment of body.assignments || []) {
                await assignmentRepo.save(assignmentRepo.create({
                    ...assignment,
                    vendorProfileId: profile.id,
                    vendorProfile: profile,
                    listingId: String(assignment.listingId || ""),
                    createdBy: userId,
                    updatedBy: userId,
                }));
            }

            return profile.id;
        });
        return this.getVendorProfile(profileId, userId);
    }

    async updateVendorProfile(id: number, body: Partial<VendorProfile>, userId: string) {
        await this.ensureVendorSchema();
        const existing = await this.vendorProfileRepo.findOneBy({ id });
        if (!existing) throw CustomErrorHandler.notFound(`Vendor profile with ID ${id} not found.`);
        const nextValues = {
            name: body.name,
            contact: body.contact,
            email: body.email,
            source: body.source,
            notes: body.notes,
            avatarUrl: body.avatarUrl,
            icon: body.icon,
            updatedBy: userId,
        };
        const changes = this.getProfileAuditChanges(existing, nextValues);
        const saved = await this.vendorProfileRepo.save(this.vendorProfileRepo.merge(existing, nextValues));
        await this.createProfileChangeUpdate(saved, changes, userId);
        return this.getVendorProfile(saved.id, userId);
    }

    async deleteVendorProfile(id: number, userId: string) {
        await this.ensureVendorSchema();
        const profile = await this.vendorProfileRepo.findOne({
            where: { id },
            relations: ["assignments"],
        });
        if (!profile) throw CustomErrorHandler.notFound(`Vendor profile with ID ${id} not found.`);
        profile.deletedBy = userId;
        await this.vendorProfileRepo.save(profile);
        for (const assignment of profile.assignments || []) {
            assignment.deletedBy = userId;
            await this.vendorAssignmentRepo.save(assignment);
            await this.vendorAssignmentRepo.softRemove(assignment);
        }
        await this.vendorProfileRepo.softRemove(profile);
        return { message: "Vendor profile deleted successfully." };
    }

    async createAssignment(vendorProfileId: number, body: VendorAssignmentPayload, userId: string) {
        await this.ensureVendorSchema();
        const profile = await this.vendorProfileRepo.findOneBy({ id: vendorProfileId });
        if (!profile) throw CustomErrorHandler.notFound(`Vendor profile with ID ${vendorProfileId} not found.`);
        let sourceAssignment: VendorAssignment | null = null;
        if (body.copyFromAssignmentId) {
            sourceAssignment = await this.vendorAssignmentRepo.findOneBy({ id: body.copyFromAssignmentId });
        }
        const payload = {
            ...(sourceAssignment || {}),
            ...body,
            id: undefined,
            legacyContactId: null,
            vendorProfileId,
            vendorProfile: profile,
            listingId: String(body.listingId || sourceAssignment?.listingId || ""),
            createdBy: userId,
            updatedBy: userId,
        };
        const assignment = await this.vendorAssignmentRepo.save(this.vendorAssignmentRepo.create(payload));
        await this.createAssignmentChangeUpdate(assignment, [{ label: "Assignment", oldValue: null, newValue: "Created" }], userId);
        return this.getVendorProfile(vendorProfileId, userId);
    }

    async updateAssignment(id: number, body: Partial<VendorAssignment>, userId: string) {
        await this.ensureVendorSchema();
        const existing = await this.vendorAssignmentRepo.findOneBy({ id });
        if (!existing) throw CustomErrorHandler.notFound(`Vendor assignment with ID ${id} not found.`);
        const nextValues = {
            ...body,
            listingId: body.listingId !== undefined ? String(body.listingId) : undefined,
            updatedBy: userId,
        };
        const changes = this.getAssignmentAuditChanges(existing, nextValues);
        const saved = await this.vendorAssignmentRepo.save(this.vendorAssignmentRepo.merge(existing, nextValues));
        await this.createAssignmentChangeUpdate(saved, changes, userId);
        return this.getVendorProfile(saved.vendorProfileId, userId);
    }

    async bulkUpdateAssignments(ids: number[], updateData: Partial<VendorAssignment>, userId: string) {
        await this.ensureVendorSchema();
        const assignments = await this.vendorAssignmentRepo.find({ where: { id: In(ids) } });
        if (assignments.length !== ids.length) throw CustomErrorHandler.notFound("One or more vendor assignments could not be found.");
        const vendorProfileId = assignments[0]?.vendorProfileId;
        for (const assignment of assignments) {
            const nextValues = { ...updateData, updatedBy: userId };
            const changes = this.getAssignmentAuditChanges(assignment, nextValues);
            const saved = await this.vendorAssignmentRepo.save(this.vendorAssignmentRepo.merge(assignment, nextValues));
            await this.createAssignmentChangeUpdate(saved, changes, userId);
        }
        return vendorProfileId ? this.getVendorProfile(vendorProfileId, userId) : { success: true };
    }

    async deleteAssignment(id: number, userId: string) {
        await this.ensureVendorSchema();
        const assignment = await this.vendorAssignmentRepo.findOneBy({ id });
        if (!assignment) throw CustomErrorHandler.notFound(`Vendor assignment with ID ${id} not found.`);
        assignment.deletedBy = userId;
        const vendorProfileId = assignment.vendorProfileId;
        await this.vendorAssignmentRepo.save(assignment);
        await this.vendorAssignmentRepo.softRemove(assignment);
        return this.getVendorProfile(vendorProfileId, userId);
    }
}
