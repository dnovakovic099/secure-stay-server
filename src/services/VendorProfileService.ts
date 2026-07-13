import { In, IsNull, Like, Repository } from "typeorm";
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
import logger from "../utils/logger.utils";
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
    private static schemaPromise: Promise<void> | null = null;
    private static legacyBackfillReady = false;
    private static legacyBackfillPromise: Promise<void> | null = null;

    private async assertSingleActiveCleanerAssignment(
        assignmentRepo: Repository<VendorAssignment>,
        assignment: Partial<VendorAssignment>,
        excludeAssignmentId?: number,
    ) {
        const listingId = String(assignment.listingId || "").trim();
        const role = String(assignment.role || "").trim().toLowerCase();
        const status = String(assignment.status || "").trim().toLowerCase();
        if (!listingId || role !== "cleaner" || status !== "active") return;

        const activeAssignments = await assignmentRepo.find({
            where: {
                listingId,
                status: "active",
                deletedAt: IsNull(),
            },
        });
        const existingActiveCleaner = activeAssignments.find(existing => (
            existing.id !== excludeAssignmentId
            && String(existing.role || "").trim().toLowerCase() === "cleaner"
        ));

        if (existingActiveCleaner) {
            throw CustomErrorHandler.validationError(
                "An active cleaner already exists for this listing. Please change the current active cleaner to 'active-backup' or 'inactive' first."
            );
        }
    }

    private async ensureVendorSchema() {
        if (VendorProfileService.schemaReady) {
            const hasProfilesTable = await this.tableExists("vendor_profiles");
            const hasAssignmentsTable = await this.tableExists("vendor_assignments");
            if (hasProfilesTable && hasAssignmentsTable) return;
            VendorProfileService.schemaReady = false;
        }

        if (VendorProfileService.schemaPromise) {
            await VendorProfileService.schemaPromise;
            return;
        }

        VendorProfileService.schemaPromise = this.ensureVendorSchemaInternal()
            .finally(() => {
                VendorProfileService.schemaPromise = null;
            });

        await VendorProfileService.schemaPromise;
    }

    private async ensureVendorSchemaInternal() {

        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS vendor_profiles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                companyName VARCHAR(255) NULL,
                contact VARCHAR(100) NULL,
                email VARCHAR(255) NULL,
                source VARCHAR(100) NULL,
                vendorAddress VARCHAR(255) NULL,
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

        await this.addColumnIfMissing("vendor_profiles", "companyName", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_profiles", "vendorAddress", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_profiles", "notes", "TEXT NULL");
        await this.addColumnIfMissing("vendor_profiles", "avatarUrl", "VARCHAR(2048) NULL");
        await this.addColumnIfMissing("vendor_profiles", "icon", "VARCHAR(100) NULL");
        await this.addColumnIfMissing("vendor_profiles", "deletedAt", "TIMESTAMP NULL");
        await this.addColumnIfMissing("vendor_profiles", "createdBy", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_profiles", "updatedBy", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_profiles", "deletedBy", "VARCHAR(255) NULL");

        await this.addColumnIfMissing("vendor_assignments", "rateType", "VARCHAR(100) NULL");
        await this.addColumnIfMissing("vendor_assignments", "customRateDescription", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_assignments", "workScheduleDays", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_assignments", "workScheduleIntervalWeeks", "INT NULL");
        await this.addColumnIfMissing("vendor_assignments", "workScheduleDayOfMonth", "INT NULL");
        await this.addColumnIfMissing("vendor_assignments", "workScheduleQuarter", "VARCHAR(50) NULL");
        await this.addColumnIfMissing("vendor_assignments", "workScheduleMonth", "VARCHAR(50) NULL");
        await this.addColumnIfMissing("vendor_assignments", "workScheduleCheckoutTiming", "VARCHAR(100) NULL");
        await this.addColumnIfMissing("vendor_assignments", "trustLevel", "INT NULL");
        await this.addColumnIfMissing("vendor_assignments", "speed", "INT NULL");
        await this.addColumnIfMissing("vendor_assignments", "costRating", "INT NULL");
        await this.addColumnIfMissing("vendor_assignments", "website_name", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_assignments", "website_link", "VARCHAR(2048) NULL");
        await this.addColumnIfMissing("vendor_assignments", "notes", "TEXT NULL");
        await this.addColumnIfMissing("vendor_assignments", "payoutDetails", "TEXT NULL");
        await this.addColumnIfMissing("vendor_assignments", "paymentIntervalMonth", "INT NULL");
        await this.addColumnIfMissing("vendor_assignments", "paymentDayOfWeek", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_assignments", "paymentWeekOfMonth", "INT NULL");
        await this.addColumnIfMissing("vendor_assignments", "paymentDayOfMonth", "INT NULL");
        await this.addColumnIfMissing("vendor_assignments", "nextServiceDate", "TIMESTAMP NULL");
        await this.addColumnIfMissing("vendor_assignments", "legacyContactId", "INT NULL");
        await this.addColumnIfMissing("vendor_assignments", "deletedAt", "TIMESTAMP NULL");
        await this.addColumnIfMissing("vendor_assignments", "createdBy", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_assignments", "updatedBy", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_assignments", "deletedBy", "VARCHAR(255) NULL");

        await this.addColumnIfMissing("vendor_profile_updates", "deletedAt", "TIMESTAMP NULL");
        await this.addColumnIfMissing("vendor_profile_updates", "createdBy", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_profile_updates", "updatedBy", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_profile_updates", "deletedBy", "VARCHAR(255) NULL");

        await this.addColumnIfMissing("vendor_assignment_updates", "deletedAt", "TIMESTAMP NULL");
        await this.addColumnIfMissing("vendor_assignment_updates", "createdBy", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_assignment_updates", "updatedBy", "VARCHAR(255) NULL");
        await this.addColumnIfMissing("vendor_assignment_updates", "deletedBy", "VARCHAR(255) NULL");

        VendorProfileService.schemaReady = true;
    }

    private async tableExists(table: string) {
        const existing = await appDatabase.query("SHOW TABLES LIKE ?", [table]);
        return Array.isArray(existing) && existing.length > 0;
    }

    private async addColumnIfMissing(table: string, column: string, definition: string) {
        const existing = await appDatabase.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
        if (Array.isArray(existing) && existing.length > 0) return;
        await appDatabase.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }

    private async ensureListingDetailCleanerColumns() {
        await this.addColumnIfMissing("listing_details", "cleaning_managed_by", "VARCHAR(100) NULL");
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

    private getLegacyProfileLookupKeys(record: Pick<Contact | VendorProfile, "contact" | "email" | "name">) {
        return [record.contact, record.email, record.name]
            .map(value => this.normalizeIdentity(value))
            .filter(Boolean);
    }

    private isMissingVendorSchemaError(error: any) {
        const message = String(error?.message || error?.sqlMessage || "");
        return message.includes("vendor_profiles") && message.includes("doesn't exist");
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
            { key: "companyName", label: "Company Name", nextValue: next.companyName },
            { key: "contact", label: "Phone Number", nextValue: next.contact },
            { key: "email", label: "Email", nextValue: next.email },
            { key: "source", label: "Source", nextValue: next.source },
            { key: "vendorAddress", label: "Vendor Address", nextValue: next.vendorAddress },
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

    private async withArchivedListingStatus<T extends Partial<VendorAssignment>>(assignment: T): Promise<T> {
        if (!assignment.listingId) return assignment;
        const listing = await this.listingRepo
            .createQueryBuilder("listing")
            .withDeleted()
            .select(["listing.id", "listing.deletedAt"])
            .where("listing.id = :listingId", { listingId: assignment.listingId })
            .getOne();
        return listing?.deletedAt ? { ...assignment, status: "archived" } : assignment;
    }

    private async getListingMeta(userId: string) {
        const listingService = new ListingService();
        const listings = await listingService.getListingNames(userId, true);
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
        const listingIsArchived = Boolean(listing?.deletedAt);
        return {
            ...assignment,
            listingName: listing?.internalListingName || listing?.name,
            internalListingName: listing?.internalListingName,
            listingDeletedAt: listing?.deletedAt || null,
            status: listingIsArchived ? "archived" : assignment.status,
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

    private buildHydratedProfile(profile: VendorProfile, listingMeta: Awaited<ReturnType<VendorProfileService["getListingMeta"]>>, userMap: Map<string, string>) {
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

    private async hydrateProfile(profile: VendorProfile, userId: string) {
        const [userMap, listingMeta] = await Promise.all([this.getUserMap(), this.getListingMeta(userId)]);
        return this.buildHydratedProfile(profile, listingMeta, userMap);
    }

    private async ensureLegacyBackfill(userId: string) {
        if (VendorProfileService.legacyBackfillReady) return;
        if (VendorProfileService.legacyBackfillPromise) {
            await VendorProfileService.legacyBackfillPromise;
            return;
        }

        VendorProfileService.legacyBackfillPromise = this.ensureLegacyBackfillInternal(userId)
            .then(() => {
                VendorProfileService.legacyBackfillReady = true;
            })
            .finally(() => {
                VendorProfileService.legacyBackfillPromise = null;
            });
        await VendorProfileService.legacyBackfillPromise;
    }

    private async ensureLegacyBackfillInternal(userId: string) {
        await this.ensureVendorSchema();

        let contacts: Contact[] = [];
        try {
            contacts = await this.contactRepo.find({ relations: ["contactUpdates"] });
        } catch (error) {
            logger.error(`Vendor legacy backfill could not load contact updates. Continuing without history. ${error}`);
            contacts = await this.contactRepo.find();
        }

        const activeContacts = contacts.filter(contact => !contact.deletedAt);
        if (!activeContacts.length) return;

        const existingLegacyAssignments = await this.vendorAssignmentRepo.find({
            where: { legacyContactId: In(activeContacts.map(contact => contact.id)) },
            select: ["legacyContactId"],
        });
        const backfilledContactIds = new Set(existingLegacyAssignments.map(assignment => assignment.legacyContactId).filter(Boolean));
        const contactsToBackfill = activeContacts.filter(contact => !backfilledContactIds.has(contact.id));
        if (!contactsToBackfill.length) return;

        const existingProfileByKey = new Map<string, number>();
        const existingProfiles = await this.vendorProfileRepo.find();
        existingProfiles
            .filter(profile => !profile.deletedAt)
            .forEach(profile => {
                this.getLegacyProfileLookupKeys(profile).forEach(key => {
                    if (!existingProfileByKey.has(key)) existingProfileByKey.set(key, profile.id);
                });
            });

        const groups = new Map<string, Contact[]>();
        contactsToBackfill.forEach(contact => {
            const key = this.getLegacyVendorKey(contact);
            groups.set(key, [...(groups.get(key) || []), contact]);
        });

        for (const group of groups.values()) {
            try {
                const result = await appDatabase.transaction(async manager => {
                    const profileRepo = manager.getRepository(VendorProfile);
                    const assignmentRepo = manager.getRepository(VendorAssignment);
                    const profileUpdateRepo = manager.getRepository(VendorProfileUpdate);
                    const assignmentUpdateRepo = manager.getRepository(VendorAssignmentUpdate);

                    const [first] = group;
                    const lookupKeys = Array.from(new Set(group.flatMap(contact => this.getLegacyProfileLookupKeys(contact))));
                    const existingProfileId = lookupKeys.map(key => existingProfileByKey.get(key)).find(Boolean);
                    let profile = existingProfileId ? await profileRepo.findOneBy({ id: existingProfileId }) : null;

                    if (!profile) {
                        profile = await profileRepo.save(profileRepo.create({
                            name: first.name || first.contact || first.email || `Vendor #${first.id}`,
                            contact: first.contact || null,
                            email: first.email || null,
                            source: first.source || null,
                            vendorAddress: first.vendorAddress || null,
                            notes: null,
                            createdBy: first.createdBy || userId,
                            updatedBy: first.updatedBy || userId,
                            createdAt: first.createdAt,
                            updatedAt: first.updatedAt,
                        }));

                        await profileUpdateRepo.save(profileUpdateRepo.create({
                            vendorProfileId: profile.id,
                            vendorProfile: profile,
                            updates: `Vendor profile created from ${group.length} legacy contact assignment${group.length === 1 ? "" : "s"}.`,
                            createdBy: userId,
                            updatedBy: userId,
                        }));
                    }

                    for (const contact of group) {
                        const assignment = await assignmentRepo.save(assignmentRepo.create({
                            vendorProfileId: profile.id,
                            vendorProfile: profile,
                            listingId: String(contact.listingId || ""),
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

                    return { profileId: profile.id, lookupKeys };
                });

                result.lookupKeys.forEach(key => {
                    if (!existingProfileByKey.has(key)) existingProfileByKey.set(key, result.profileId);
                });
            } catch (error) {
                const first = group[0];
                logger.error(`Vendor legacy backfill skipped contact group ${this.getLegacyVendorKey(first)}. ${error}`);
            }
        }
    }

    async getVendorProfiles(query: any, userId: string) {
        try {
            return await this.getVendorProfilesInternal(query, userId);
        } catch (error) {
            if (!this.isMissingVendorSchemaError(error) || query?._vendorSchemaRetry) throw error;
            VendorProfileService.schemaReady = false;
            await this.ensureVendorSchema();
            return this.getVendorProfilesInternal({ ...query, _vendorSchemaRetry: true }, userId);
        }
    }

    private async getVendorProfilesInternal(query: any, userId: string) {
        await this.ensureLegacyBackfill(userId);
        const page = Number(query.page || 1);
        const limit = Math.min(Number(query.limit || 5000), 10000);
        const keyword = String(query.keyword || query.name || "").trim();
        const where = keyword
            ? [
                { name: Like(`%${keyword}%`) },
                { contact: Like(`%${keyword}%`) },
                { email: Like(`%${keyword}%`) },
                { vendorAddress: Like(`%${keyword}%`) },
            ]
            : {};

        const [[profiles, total], userMap, listingMeta] = await Promise.all([
            this.vendorProfileRepo.findAndCount({
                where,
                relations: ["assignments"],
                order: { name: "ASC" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.getUserMap(),
            this.getListingMeta(userId),
        ]);

        const hydrated = profiles.map(profile => this.buildHydratedProfile(profile, listingMeta, userMap));
        return { vendors: hydrated, total };
    }

    async getVendorProfile(id: number, userId: string) {
        try {
            return await this.getVendorProfileInternal(id, userId);
        } catch (error) {
            if (!this.isMissingVendorSchemaError(error)) throw error;
            VendorProfileService.schemaReady = false;
            await this.ensureVendorSchema();
            return this.getVendorProfileInternal(id, userId);
        }
    }

    private async getVendorProfileInternal(id: number, userId: string) {
        await this.ensureLegacyBackfill(userId);
        const profile = await this.vendorProfileRepo.findOne({
            where: { id },
            relations: ["assignments", "assignments.updates", "updates"],
        });
        if (!profile) throw CustomErrorHandler.notFound(`Vendor profile with ID ${id} not found.`);
        return this.hydrateProfile(profile, userId);
    }

    async getActiveCleanerAssignmentsByListing(listingIds: string[] = [], userId: string) {
        await this.ensureVendorSchema();
        await this.ensureListingDetailCleanerColumns();
        const uniqueListingIds = Array.from(new Set(listingIds.map(id => String(id || "").trim()).filter(Boolean)));
        if (!uniqueListingIds.length) return {};

        const [assignments, listingDetails] = await Promise.all([
            this.vendorAssignmentRepo.find({
                where: {
                    listingId: In(uniqueListingIds),
                    role: "Cleaner",
                    status: "active",
                    deletedAt: IsNull(),
                },
                relations: ["vendorProfile", "updates"],
            }),
            this.listingDetailRepo.find({
                where: {
                    listingId: In(uniqueListingIds.map(id => Number(id)).filter(Number.isFinite)),
                },
            }),
        ]);
        const listingMeta = await this.getListingMeta(userId);
        const userMap = await this.getUserMap();
        const fallbackByListing = new Map(listingDetails.map(detail => [String(detail.listingId), detail]));
        const result: Record<string, any> = {};

        uniqueListingIds.forEach(listingId => {
            const activeCleaner = assignments.find(assignment => String(assignment.listingId) === listingId);
            const fallback = fallbackByListing.get(listingId);
            if (activeCleaner) {
                result[listingId] = {
                    hasActiveCleaner: true,
                    managedBy: activeCleaner.managedBy || null,
                    assignment: this.hydrateAssignment(activeCleaner, listingMeta, userMap),
                    vendor: activeCleaner.vendorProfile || null,
                    fallbackManagedBy: fallback?.cleaningManagedBy || null,
                };
            } else {
                result[listingId] = {
                    hasActiveCleaner: false,
                    managedBy: fallback?.cleaningManagedBy || null,
                    assignment: null,
                    vendor: null,
                    fallbackManagedBy: fallback?.cleaningManagedBy || null,
                };
            }
        });

        return result;
    }

    async updateListingCleanerManagedBy(listingId: string, managedBy: string | null, userId: string) {
        await this.ensureVendorSchema();
        await this.ensureListingDetailCleanerColumns();
        const normalizedListingId = String(listingId || "").trim();
        if (!normalizedListingId) throw CustomErrorHandler.validationError("Listing ID is required.");
        const nextManagedBy = managedBy ? String(managedBy).trim() : null;

        const activeCleaner = await this.vendorAssignmentRepo.findOne({
            where: {
                listingId: normalizedListingId,
                role: "Cleaner",
                status: "active",
                deletedAt: IsNull(),
            },
            relations: ["vendorProfile", "updates"],
        });

        if (activeCleaner) {
            await this.updateAssignment(activeCleaner.id, { managedBy: nextManagedBy }, userId);
            const updated = await this.getActiveCleanerAssignmentsByListing([normalizedListingId], userId);
            return {
                ...updated[normalizedListingId],
                source: "active-cleaner",
            };
        }

        const numericListingId = Number(normalizedListingId);
        if (!Number.isFinite(numericListingId)) throw CustomErrorHandler.validationError("Listing ID must be numeric.");
        let listingDetail = await this.listingDetailRepo.findOneBy({ listingId: numericListingId });
        if (!listingDetail) {
            listingDetail = this.listingDetailRepo.create({
                listingId: numericListingId,
                createdBy: userId,
                updatedBy: userId,
            });
        }
        listingDetail.cleaningManagedBy = nextManagedBy;
        listingDetail.updatedBy = userId;
        await this.listingDetailRepo.save(listingDetail);

        const updated = await this.getActiveCleanerAssignmentsByListing([normalizedListingId], userId);
        return {
            ...updated[normalizedListingId],
            source: "listing-fallback",
            warning: nextManagedBy === "LL"
                ? "Luxury Lodging is set to manage cleaning, but no active cleaner is assigned to this property."
                : null,
        };
    }

    async createVendorProfile(body: VendorProfilePayload, userId: string) {
        await this.ensureVendorSchema();
        const profileId = await appDatabase.transaction(async manager => {
            const profileRepo = manager.getRepository(VendorProfile);
            const assignmentRepo = manager.getRepository(VendorAssignment);

            const profile = await profileRepo.save(profileRepo.create({
                name: body.name,
                companyName: body.companyName || null,
                contact: body.contact || null,
                email: body.email || null,
                source: body.source || null,
                vendorAddress: body.vendorAddress || null,
                notes: body.notes || null,
                avatarUrl: body.avatarUrl || null,
                icon: body.icon || null,
                createdBy: userId,
                updatedBy: userId,
            }));

            for (const assignment of body.assignments || []) {
                const assignmentPayload = {
                    ...assignment,
                    vendorProfileId: profile.id,
                    vendorProfile: profile,
                    listingId: String(assignment.listingId || ""),
                    createdBy: userId,
                    updatedBy: userId,
                };
                await this.assertSingleActiveCleanerAssignment(assignmentRepo, assignmentPayload);
                await assignmentRepo.save(assignmentRepo.create(assignmentPayload));
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
            companyName: body.companyName,
            contact: body.contact,
            email: body.email,
            source: body.source,
            vendorAddress: body.vendorAddress,
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
        const payload = await this.withArchivedListingStatus({
            ...(sourceAssignment || {}),
            ...body,
            id: undefined,
            legacyContactId: null,
            vendorProfileId,
            vendorProfile: profile,
            listingId: String(body.listingId || sourceAssignment?.listingId || ""),
            createdBy: userId,
            updatedBy: userId,
        });
        await this.assertSingleActiveCleanerAssignment(this.vendorAssignmentRepo, payload);
        const assignment = await this.vendorAssignmentRepo.save(this.vendorAssignmentRepo.create(payload));
        await this.createAssignmentChangeUpdate(assignment, [{ label: "Assignment", oldValue: null, newValue: "Created" }], userId);
        return this.getVendorProfile(vendorProfileId, userId);
    }

    async updateAssignment(id: number, body: Partial<VendorAssignment>, userId: string) {
        await this.ensureVendorSchema();
        const existing = await this.vendorAssignmentRepo.findOneBy({ id });
        if (!existing) throw CustomErrorHandler.notFound(`Vendor assignment with ID ${id} not found.`);
        const nextValues = await this.withArchivedListingStatus({
            ...body,
            listingId: body.listingId !== undefined ? String(body.listingId) : existing.listingId,
            updatedBy: userId,
        });
        await this.assertSingleActiveCleanerAssignment(this.vendorAssignmentRepo, { ...existing, ...nextValues }, existing.id);
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
            const nextValues = await this.withArchivedListingStatus({
                ...updateData,
                listingId: updateData.listingId !== undefined ? String(updateData.listingId) : assignment.listingId,
                updatedBy: userId,
            });
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
