import { appDatabase } from "../utils/database.util";
import { Issue } from "../entity/Issue";
import { Between, Not, LessThan, In, MoreThan } from "typeorm";
import * as XLSX from 'xlsx';
import { sendUnresolvedIssueEmail } from "./IssuesEmailService";
import { Listing } from "../entity/Listing";

export class IssuesService {
    private issueRepo = appDatabase.getRepository(Issue);

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async createIssue(data: Partial<Issue>, userId: string, fileNames?: string[]) {
        const listing_name = (await appDatabase.getRepository(Listing).findOne({ where: { id: Number(data.listing_id) } }))?.internalListingName || ""

        if (data.status === 'Completed') {
            data.completed_at = new Date();
            data.completed_by = userId;
        } else {
            data.completed_at = null;
            data.completed_by = null;
        }

        const newIssue = this.issueRepo.create({
            ...data,
            listing_name: listing_name,
            fileNames: fileNames ? JSON.stringify(fileNames) : ""
        });

        const savedIssue = await this.issueRepo.save(newIssue);
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

        if (status) {
            const statusArray = status.split(',').map(s => s.trim());
            queryOptions.where.status = In(statusArray);
        }   

        if (listingId) {
            queryOptions.where.listing_name = listingId;
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

    async updateIssue(id: number, data: Partial<Issue>, userId: string, fileNames?: string[]) {
        const issue = await this.issueRepo.findOne({ 
            where: { id }
        });

        if (!issue) {
            throw new Error('Issue not found');
        }

        if (data.status === 'Completed') {
            data.completed_at = new Date();
            data.completed_by = userId;
        } else {
            data.completed_at = null;
            data.completed_by = null;
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

        return await this.issueRepo.save(issue);
    }

    async deleteIssue(id: number) {
        const issue = await this.issueRepo.findOneBy({ id });
        if (issue) {
            return await this.issueRepo.remove(issue);
        }
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
} 