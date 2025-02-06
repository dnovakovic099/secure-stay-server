import { appDatabase } from "../utils/database.util";
import { Issue } from "../entity/Issue";
import { Between, Not } from "typeorm";
import * as XLSX from 'xlsx';

export class IssuesService {
    private issueRepo = appDatabase.getRepository(Issue);

    async createIssue(data: Partial<Issue>) {
        const issue = this.issueRepo.create(data);
        const savedIssue = await this.issueRepo.save(issue);
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
        guestName?: string
    ) {
        const queryOptions: any = {
            where: {},
            order: { 
                status: "ASC",
                // created_at: 'DESC'
            },
            skip: (page - 1) * limit,
            take: limit
        };

        if (fromDate && toDate) {
            const startDate = new Date(fromDate);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(toDate);
            endDate.setHours(23, 59, 59, 999);

            queryOptions.where = {
                created_at: Between(
                    startDate,
                    endDate
                )
            };
        }

        if (status) {
            queryOptions.where.status = status;
        }   

        if (listingId) {
            queryOptions.where.listing_id = listingId;
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

    async updateIssue(id: number, data: Partial<Issue>) {
        await this.issueRepo.update(id, data);
        return await this.issueRepo.findOne({ where: { id } });
    }

    async deleteIssue(id: number) {
        return await this.issueRepo.delete(id);
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
            'Needs Attention': issue.needs_attention,
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
} 