import { appDatabase } from "../utils/database.util";
import { Issue } from "../entity/Issue";
import { Between, Not, LessThan, In, MoreThan, Like } from "typeorm";
import * as XLSX from 'xlsx';
import { sendUnresolvedIssueEmail } from "./IssuesEmailService";
import { Listing } from "../entity/Listing";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ActionItems } from "../entity/ActionItems";
import { IssueUpdates } from "../entity/IsssueUpdates";
import { UsersEntity } from "../entity/Users";
import { ListingService } from "./ListingService";
import { tagIds } from "../constant";
import { ReservationInfoService } from "./ReservationInfoService";
import { ActionItemsUpdates } from "../entity/ActionItemsUpdates";
import { FileInfo } from "../entity/FileInfo";
import path from "path";
import logger from "../utils/logger.utils";
import { format } from "date-fns";

export class IssuesService {
    private issueRepo = appDatabase.getRepository(Issue);
    private actionItemRepo = appDatabase.getRepository(ActionItems);
    private actionItemUpdatesRepo = appDatabase.getRepository(ActionItemsUpdates);
    private issueUpdatesRepo = appDatabase.getRepository(IssueUpdates);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private fileInfoRepo = appDatabase.getRepository(FileInfo);

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async createIssue(data: Partial<Issue>, userId: string, fileInfo?: { fileName: string, filePath: string, mimeType: string; originalName: string; }[]) {
        const listing_name = (await appDatabase.getRepository(Listing).findOne({ where: { id: Number(data.listing_id) } }))?.internalListingName || ""

        if (data.status === 'Completed') {
            data.completed_at = new Date();
            data.completed_by = userId;
        } else {
            data.completed_at = null;
            data.completed_by = null;
        }

        if (data.mistake && data.mistake === "Resolved") {
            data.mistakeResolvedOn = format(new Date(), 'yyyy-MM-dd');
        }

        const newIssue = this.issueRepo.create({
            ...data,
            listing_name: listing_name,
            fileNames: fileInfo ? JSON.stringify(fileInfo.map(file => file.fileName)) : ""
        });

        const savedIssue = await this.issueRepo.save(newIssue);

        if (fileInfo) {
            for (const file of fileInfo) {
                const fileRecord = new FileInfo();
                fileRecord.entityType = 'issues';
                fileRecord.entityId = savedIssue.id;
                fileRecord.fileName = file.fileName;
                fileRecord.createdBy = userId;
                fileRecord.localPath = file.filePath;
                fileRecord.mimetype = file.mimeType;
                fileRecord.originalName = file.originalName;
                await this.fileInfoRepo.save(fileRecord);
            }
        }
        return savedIssue;
    }

    async getIssues(
        page: number = 1, 
        limit: number = 10, 
        fromDate: string = '', 
        toDate: string = '', 
        status: string = '', 
        listingId: string = '',
        isClaimOnly?: boolean,
        claimAmount?: string,
        guestName?: string,
        issueIds?: string,
        reservationId?: string
    ) {
        const queryOptions: any = {
            where: {},
            order: { 
                created_at: 'DESC',
                status: "ASC"
            },
            skip: (page - 1) * limit,
            take: limit
        };

        if (reservationId) {
            queryOptions.where.reservation_id = reservationId;
        }

        if (issueIds) {
            const idsArray = issueIds.split(',').map(id => Number(id.trim()));
            queryOptions.where.id = In(idsArray);
        }

        if (fromDate && toDate) {
            const startDate = new Date(fromDate);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(toDate);
            endDate.setDate(endDate.getDate() + 1);
            endDate.setUTCHours(0, 0, 0, 0);

            queryOptions.where.created_at = Between(
                startDate,
                endDate
            );
        } else if (fromDate) {
            const startDate = new Date(fromDate);
            startDate.setUTCHours(0, 0, 0, 0);
            queryOptions.where.created_at = MoreThan(startDate);
        } else if (toDate) {
            const endDate = new Date(toDate);
            endDate.setUTCHours(23, 59, 59, 999);
            queryOptions.where.created_at = LessThan(endDate);
        }
        
        if (status && Array.isArray(status)) {
            queryOptions.where.status = In(status);
        }  

        if (listingId && Array.isArray(listingId)) {
            queryOptions.where.listing_id = In(listingId);
        }

        if (isClaimOnly) {
            queryOptions.where.claim_resolution_status = Not('N/A');
        }

        if (claimAmount) {
            queryOptions.where.claim_resolution_amount = claimAmount;
        }

        if (guestName) {
            queryOptions.where.guest_name = guestName;
        }

        const [issues, total] = await this.issueRepo.findAndCount(queryOptions);

        return {
            data: issues,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async updateIssue(id: number, data: Partial<Issue>, userId: string, fileInfo?: { fileName: string, filePath: string, mimeType: string; originalName: string; }[]) {
        const issue = await this.issueRepo.findOne({ 
            where: { id }
        });

        if (!issue) {
            throw new Error('Issue not found');
        }

        if (issue.status !== "Completed" && data.status === 'Completed') {
            data.completed_at = new Date();
            data.completed_by = userId;
        } else {
            data.completed_at = null;
            data.completed_by = null;
        }

        if (data.mistake && data.mistake === "Resolved") {
            data.mistakeResolvedOn = format(new Date(), 'yyyy-MM-dd');
        }

        let listing_name = '';
        if (data.listing_id) {
            listing_name = (await appDatabase.getRepository(Listing).findOne({ where: { id: Number(data.listing_id) } }))?.internalListingName || "";
        }

        Object.assign(issue, {
            ...data,
            ...(data.listing_id && { listing_name: listing_name }),
            updated_by: userId,
        });

        const updatedData = await this.issueRepo.save(issue);
        if (fileInfo) {
            for (const file of fileInfo) {
                const fileRecord = new FileInfo();
                fileRecord.entityType = 'issues';
                fileRecord.entityId = updatedData.id;
                fileRecord.fileName = file.fileName;
                fileRecord.createdBy = userId;
                fileRecord.localPath = file.filePath;
                fileRecord.mimetype = file.mimeType;
                fileRecord.originalName = file.originalName;
                await this.fileInfoRepo.save(fileRecord);
            }
        }
        return updatedData;
    }

    async deleteIssue(id: number, userId: string) {
        const issue = await this.issueRepo.findOneBy({ id });
        if (!issue) {
            throw CustomErrorHandler.notFound(`Issue with the id ${id} not found`)
        }

        issue.deleted_at = new Date();
        issue.deleted_by = userId;

        await this.issueRepo.save(issue);
        return issue;
    }

    async getUpsells(fromDate: string, toDate: string, listingId: number) {
        return await this.issueRepo.find({
            where: {
                listing_id: String(listingId),
                created_at: Between(
                    new Date(fromDate),
                    new Date(toDate)
                )
            }
        });
    }

    async exportIssuesToExcel(): Promise<Buffer> {
        const issues = await this.issueRepo.find();

        const formattedData = issues.map(issue => ({
            Status: issue.status,
            Listing: issue.listing_id,
            'Next Steps': issue.next_steps,
            'Claim Resolution Status': issue.claim_resolution_status,
            'Claim Resolution Amount': issue.claim_resolution_amount,
            'Reservation ID': issue.reservation_id,
            'Check-In Date': issue.check_in_date,
            'Reservation Amount': issue.reservation_amount,
            Channel: issue.channel,
            'Guest Name': issue.guest_name,
            'Guest Contact': issue.guest_contact_number,
            'Issue Description': issue.issue_description,
            'Owner Notes': issue.owner_notes,
            Creator: issue.creator,
            'Date Reported': issue.date_time_reported,
            'Contractor Contacted': issue.date_time_contractor_contacted,
            'Contractor Deployed': issue.date_time_contractor_deployed,
            'Work Finished': issue.date_time_work_finished,
            'Final Contractor': issue.final_contractor_name,
            'Final Price': issue.final_price
        }));

        const worksheet = XLSX.utils.json_to_sheet(formattedData);
        const csv = XLSX.utils.sheet_to_csv(worksheet);
    
        return Buffer.from(csv, 'utf-8');
    }

    async checkUnresolvedIssues() {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        const unresolvedIssues = await this.issueRepo.find({
            where: {
                status: Not('Completed'),
                created_at: LessThan(threeDaysAgo)
            }
        });

        for (const issue of unresolvedIssues) {
            await sendUnresolvedIssueEmail(issue);
        }
    }

    public async getIssuesByReservationId(reservationId: string) {
        return await this.issueRepo.find({
            where: {
                reservation_id: reservationId
            }
        });
    }

    async getIssueById(id: number) {
        const issue = await this.issueRepo.findOne({ where: { id } });
        if (!issue) {
            throw new Error('Issue not found');
        }
        return issue;
    }

    async getIssuesByListingId(listingId: string) {
        return await this.issueRepo.find({ 
            where: { 
                listing_id: String(listingId),
                status: Not('Completed')
            } 
        });
    }

    async migrateIssueToActionItems(body: any, userId: string) {
        const { id, category, status } = body;
        const issue = await this.issueRepo.findOne({
            where: { id },
            relations: ["issueUpdates"]
        });

        if (!issue) {
            throw CustomErrorHandler.notFound(`Issue with ID ${id} not found`);
        }

        // Create a new action item based on the issue
        const actionItem: Partial<ActionItems> = {
            item: `[MOVED FROM ISSUES PAGE]  ${issue.issue_description}`,
            category: category,
            status: status,
            createdBy: userId,
            listingId: Number(issue.listing_id),
            reservationId: Number(issue.reservation_id),
            listingName: issue.listing_name,
            guestName: issue.guest_name,
        };

        // Save the action item to the database
        const newActionItem = this.actionItemRepo.create(actionItem);
        const savedActionItem = await this.actionItemRepo.save(newActionItem);

        // Save ALL issue updates as action item updates
        if (issue.issueUpdates?.length > 0) {
            const actionItemUpdates = issue.issueUpdates.map((update) =>
                this.actionItemUpdatesRepo.create({
                    updates: update.updates,
                    createdBy: update.createdBy,
                    updatedBy: update.updatedBy,
                    createdAt: update.createdAt,
                    updatedAt: update.updatedAt,
                    actionItems: savedActionItem,
                })
            );

            await this.actionItemUpdatesRepo.save(actionItemUpdates); // save all at once
        }

        await this.issueRepo.remove(issue);
        return savedActionItem;
    }

    async createIssueUpdates(body: any, userId: string) {
        const { issueId, updates } = body;

        const issue = await this.issueRepo.findOne({ where: { id: issueId } });
        if (!issue) {
            throw CustomErrorHandler.notFound(`Issue with ID ${issueId} not found`);
        }

        const newUpdate = this.issueUpdatesRepo.create({
            issue: issue,
            updates: updates,
            createdBy: userId,
        });

        const result = await this.issueUpdatesRepo.save(newUpdate);
        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));
        result.createdBy = userMap.get(result.createdBy) || result.createdBy;
        result.updatedBy = userMap.get(result.updatedBy) || result.updatedBy;
        return result;
    }

    async updateIssueUpdates(body: any, userId: string) {
        const { id, updates } = body;

        const existingIssueUpdate = await this.issueUpdatesRepo.findOne({ where: { id } });
        if (!existingIssueUpdate) {
            throw CustomErrorHandler.notFound(`Issue update with ID ${id} not found`);
        }
        existingIssueUpdate.updates = updates;
        existingIssueUpdate.updatedBy = userId;

        const result = await this.issueUpdatesRepo.save(existingIssueUpdate);
        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));
        result.createdBy = userMap.get(result.createdBy) || result.createdBy;
        result.updatedBy = userMap.get(result.updatedBy) || result.updatedBy;
        return result;
    }

    async deleteIssueUpdates(id: number, userId: string) {
        const issueUpdate = await this.issueUpdatesRepo.findOneBy({ id });
        if (!issueUpdate) {
            throw CustomErrorHandler.notFound(`Issue update with the id ${id} not found`);
        }

        issueUpdate.deletedAt = new Date();
        issueUpdate.deletedBy = userId;

        await this.issueUpdatesRepo.save(issueUpdate);
        return issueUpdate;
    }

    async getGuestIssues(body: any, userId: string) {
        const {
            category, listingId, propertyType,
            fromDate, toDate, status, guestName,
            page, limit, issueId, reservationId, keyword, channel
        } = body;

        let listingIds = [];
        if (propertyType && propertyType.length > 0) {
            const listingService = new ListingService();
            listingIds = (await listingService.getListingsByTagIds(propertyType, userId)).map(l => l.id);
        } else {
            listingIds = listingId;
        }

        const [issues, total] = await this.issueRepo.findAndCount({
            where: {
                ...(category && category.length > 0 && { category: In(category) }),
                ...(listingIds && listingIds.length > 0 && { listing_id: In(listingIds) }),
                ...(status && status.length > 0 && { status: In(status) }),
                ...(fromDate && toDate && { created_at: Between(fromDate, toDate) }),
                ...(guestName && { guest_name: guestName }),
                ...(issueId && issueId.length > 0 && { id: In(issueId) }),
                ...(reservationId && reservationId.length > 0 && { reservation_id: In(reservationId) }),
                ...(keyword && { issue_description: Like(`%${keyword}%`) }),
                ...(channel && channel.length > 0 && { channel: In(channel) }),
            },
            relations: ["issueUpdates"],
            take: limit,
            skip: (Number(page) - 1) * Number(limit),
            order: {
                id: "DESC"
            }
        });

        for (const issue of issues) {
            const issueWithInfo = issue as Issue & { reservationInfo?: any; };
            if (issue.reservation_id && issue.reservation_id !== "NA") {
                const reservationService = new ReservationInfoService();
                issueWithInfo.reservationInfo = await reservationService.getReservationById(Number(issue.reservation_id));
            } else {
                issueWithInfo.reservationInfo = null;
            }
        }

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));
        const fileInfoList = await this.fileInfoRepo.find({ where: { entityType: 'issues' } });

        const transformedIssues = issues.map(issue => {
            return {
                ...issue,
                created_by: userMap.get(issue.created_by) || issue.created_by,
                updated_by: userMap.get(issue.updated_by) || issue.updated_by,
                issueUpdates: issue.issueUpdates.map(update => ({
                    ...update,
                    createdBy: userMap.get(update.createdBy) || update.createdBy,
                    updatedBy: userMap.get(update.updatedBy) || update.updatedBy,
                })),
                fileInfo: fileInfoList.filter(file => file.entityId === issue.id),
                assigneeName: userMap.get(issue.assignee) || issue.assignee,
                assigneeList: users.map((user) => { return { uid: user.uid, name: `${user.firstName} ${user.lastName}` }; })
            };
        });

        return {
            issues: transformedIssues,
            total
        }
    }

    async bulkUpdateIssues(ids: number[], updateData: Partial<Issue>, userId: string) {
        try {
            // Validate that all issues exist
            const existingIssues = await this.issueRepo.find({
                where: { id: In(ids) }
            });

            if (existingIssues.length !== ids.length) {
                const foundIds = existingIssues.map(issue => issue.id);
                const missingIds = ids.filter(id => !foundIds.includes(id));
                throw CustomErrorHandler.notFound(`Issues with IDs ${missingIds.join(', ')} not found`);
            }

            // Update all issues with the provided data
            const updatePromises = existingIssues.map(async (issue) => {
                // Only update fields that are provided in updateData
                if (updateData.status !== undefined) {
                    issue.status = updateData.status;
                    if (updateData.status === 'Completed') {
                        issue.completed_at = new Date();
                        issue.completed_by = userId;
                    } else {
                        issue.completed_at = null;
                        issue.completed_by = null;
                    }
                }
                if (updateData.category !== undefined) {
                    issue.category = updateData.category;
                }
                if (updateData.issue_description !== undefined) {
                    issue.issue_description = updateData.issue_description;
                }
                if (updateData.claim_resolution_status !== undefined) {
                    issue.claim_resolution_status = updateData.claim_resolution_status;
                }
                if (updateData.claim_resolution_amount !== undefined) {
                    issue.claim_resolution_amount = updateData.claim_resolution_amount;
                }
                if (updateData.estimated_reasonable_price !== undefined) {
                    issue.estimated_reasonable_price = updateData.estimated_reasonable_price;
                }
                if (updateData.final_price !== undefined) {
                    issue.final_price = updateData.final_price;
                }
                if (updateData.owner_notes !== undefined) {
                    issue.owner_notes = updateData.owner_notes;
                }
                if (updateData.next_steps !== undefined) {
                    issue.next_steps = updateData.next_steps;
                }
                if (updateData.listing_id !== undefined) {
                    const listing_name = (await appDatabase.getRepository(Listing).findOne({ 
                        where: { id: Number(updateData.listing_id) } 
                    }))?.internalListingName || "";
                    issue.listing_id = updateData.listing_id;
                    issue.listing_name = listing_name;
                }
                if (updateData.guest_name !== undefined) {
                    issue.guest_name = updateData.guest_name;
                }
                if (updateData.guest_contact_number !== undefined) {
                    issue.guest_contact_number = updateData.guest_contact_number;
                }
                if (updateData.channel !== undefined) {
                    issue.channel = updateData.channel;
                }
                if (updateData.check_in_date !== undefined) {
                    issue.check_in_date = updateData.check_in_date;
                }
                if (updateData.reservation_amount !== undefined) {
                    issue.reservation_amount = updateData.reservation_amount;
                }
                if (updateData.reservation_id !== undefined) {
                    issue.reservation_id = updateData.reservation_id;
                }
                if (updateData.date_time_reported !== undefined) {
                    issue.date_time_reported = updateData.date_time_reported;
                }
                if (updateData.date_time_contractor_contacted !== undefined) {
                    issue.date_time_contractor_contacted = updateData.date_time_contractor_contacted;
                }
                if (updateData.date_time_contractor_deployed !== undefined) {
                    issue.date_time_contractor_deployed = updateData.date_time_contractor_deployed;
                }
                if (updateData.date_time_work_finished !== undefined) {
                    issue.date_time_work_finished = updateData.date_time_work_finished;
                }
                if (updateData.final_contractor_name !== undefined) {
                    issue.final_contractor_name = updateData.final_contractor_name;
                }
                
                issue.updated_by = userId;
                return this.issueRepo.save(issue);
            });

            const updatedIssues = await Promise.all(updatePromises);
            
            return {
                success: true,
                updatedCount: updatedIssues.length,
                message: `Successfully updated ${updatedIssues.length} issues`
            };
        } catch (error) {
            throw error;
        }
    }

    async migrateFilesToDrive() {
        //get all issues
        const issues = await this.issueRepo.find();
        const fileInfo = await this.fileInfoRepo.find({ where: { entityType: 'issues' } });

        for (const issue of issues) {
            try {
                if (issue.fileNames) {
                    const fileNames = JSON.parse(issue.fileNames) as string[];
                    const filesForIssue = fileInfo.filter(file => file.entityId === issue.id);
                    for (const file of fileNames) {
                        const fileExists = filesForIssue.find(f => f.fileName === file);
                        if (!fileExists) {
                            const fileRecord = new FileInfo();
                            fileRecord.entityType = 'issues';
                            fileRecord.entityId = issue.id;
                            fileRecord.fileName = file;
                            fileRecord.createdBy = issue.created_by;
                            fileRecord.localPath = `${process.cwd()}/dist/public/issues/${file}`;
                            fileRecord.mimetype = null;
                            fileRecord.originalName = null;
                            await this.fileInfoRepo.save(fileRecord);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Error migrating files for issue ID ${issue.id}: ${error.message}`);
            }
        }
    }

    async updateAssignee(id: number, assignee: string, userId: string) {
        const issue = await this.issueRepo.findOne({ where: { id } });
        if (!issue) {
            throw CustomErrorHandler.notFound(`Issue with ID ${id} not found`);
        }
        issue.assignee = assignee;
        issue.updated_by = userId;
        return await this.issueRepo.save(issue);
    }

    async updateUrgency(id: number, urgency: number, userId: string) {
        const issue = await this.issueRepo.findOne({ where: { id } });
        if (!issue) {
            throw CustomErrorHandler.notFound(`Issue with ID ${id} not found`);
        }
        issue.urgency = urgency;
        issue.updated_by = userId;
        return await this.issueRepo.save(issue);
    }

    async updateMistake(id: number, mistake: string, userId: string) {
        const issue = await this.issueRepo.findOne({ where: { id } });
        if (!issue) {
            throw CustomErrorHandler.notFound(`Issue with ID ${id} not found`);
        }
        issue.mistake = mistake;
        if (mistake === "Resolved") {
            issue.mistakeResolvedOn = format(new Date(), 'yyyy-MM-dd');
        } else {
            issue.mistakeResolvedOn = null;
        }
        issue.updated_by = userId;
        return await this.issueRepo.save(issue);
    }

    async updateStatus(id: number, status: string, userId: string) {
        const issue = await this.issueRepo.findOne({ where: { id } });
        if (!issue) {
            throw CustomErrorHandler.notFound(`Issue with ID ${id} not found`);
        }
        issue.status = status;
        issue.updated_by = userId;
        return await this.issueRepo.save(issue);
    }
} 