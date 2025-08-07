import { appDatabase } from "../utils/database.util";
import { Claim } from "../entity/Claim";
import { Between, Not, LessThan, In, Equal, ILike } from "typeorm";
import * as XLSX from 'xlsx';
import { sendUnresolvedClaimEmail } from "./ClaimsEmailService";
import { Listing } from "../entity/Listing";
import { UsersEntity } from "../entity/Users";
import CustomErrorHandler from "../middleware/customError.middleware";
import { addDays, format } from "date-fns";
import { buildClaimReminderMessage } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import { ListingService } from "./ListingService";

export class ClaimsService {
    private claimRepo = appDatabase.getRepository(Claim);
    private usersRepo = appDatabase.getRepository(UsersEntity); 

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async createClaim(data: Partial<Claim>, userId: string, fileNames?: string[]) {
        const listing_name = (await appDatabase.getRepository(Listing).findOne({ where: { id: Number(data.listing_id) } }))?.internalListingName || ""
        const newClaim = this.claimRepo.create({
            ...data,
            listing_name: listing_name,
            fileNames: fileNames ? JSON.stringify(fileNames) : "",
            created_by: userId
        });

        const savedClaim = await this.claimRepo.save(newClaim);
        return savedClaim;
    }

    async getClaims(
        page: number = 1, 
        limit: number = 10, 
        fromDate: string = '', 
        toDate: string = '', 
        status: string = '', 
        listingId: string = '',
        claimAmount?: string,
        guestName?: string,
        claimIds?: string,
        propertyType?: string,
        keyword?: string
    ) {
        const queryOptions: any = {
            where: {
                ...(claimIds && claimIds.length > 0 && { id: In(claimIds as any) }),
            },
            order: { 
                created_at: 'DESC',
                status: "ASC"
            },
            skip: (page - 1) * limit,
            take: limit
        };

        if (fromDate && toDate) {
            const startDate = new Date(fromDate);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(toDate);
            
            endDate.setDate(endDate.getDate() + 1);
            endDate.setUTCHours(0, 0, 0, 0);

            queryOptions.where = {
                created_at: Between(
                    startDate,
                    endDate
                )
            };
        }

        if (status && Array.isArray(status)) {
            queryOptions.where.status = In(status);
        }

        if (listingId && Array.isArray(listingId)) {
            queryOptions.where.listing_id = In(listingId);
        }

        if (claimAmount) {
            queryOptions.where.client_paid_amount = claimAmount;
        }

        if (guestName) {
            queryOptions.where.guest_name = guestName;
        }

        if (propertyType && Array.isArray(propertyType)) {
            const listingService = new ListingService();
            const listingIds = (await listingService.getListingsByTagIds(propertyType)).map(l => l.id);
            queryOptions.where.listing_id = In(listingIds);
        }

        const where = keyword
        ? [
            { ...queryOptions.where, description: ILike(`%${keyword}%`) },
            { ...queryOptions.where, guest_name: ILike(`%${keyword}%`) },
            { ...queryOptions.where, airbnb_resolution: ILike(`%${keyword}%`) },
            { ...queryOptions.where, claim_type: ILike(`%${keyword}%`) },
        ]
        : queryOptions.where;

        queryOptions.where = where;

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));     

        const [claims, total] = await this.claimRepo.findAndCount(queryOptions);

        const transformedData = claims.map(claim => {
            return {
                ...claim,
                updated_by: userMap.get(claim.updated_by) || claim.updated_by,
            };
        })

        return {
            data: transformedData,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async updateClaim(id: number, data: Partial<Claim>, userId: string, fileNames?: string[]) {
        const claim = await this.claimRepo.findOne({ 
            where: { id }
        });

        if (!claim) {
            throw new Error('Claim not found');
        }

        let listing_name = '';
        if (data.listing_id) {
            listing_name = (await appDatabase.getRepository(Listing).findOne({ where: { id: Number(data.listing_id) } }))?.internalListingName || "";
        }
        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));
        
        Object.assign(claim, {
            ...data,
            ...(data.listing_id && { listing_name: listing_name }),
            updated_by: userId,
        });

        return await this.claimRepo.save(claim);
    }

    async deleteClaim(id: number, userId: string) {
        const claim = await this.claimRepo.findOne({ where: { id } });
        if (!claim) {
            throw CustomErrorHandler.notFound(`Claim with ID ${id} not found.`);
        }

        claim.deleted_by = userId;
        claim.deleted_at = new Date();
        await this.claimRepo.save(claim);
        return { message: 'Claim deleted successfully' };
    }

    async getUpsells(fromDate: string, toDate: string, listingId: number) {
        return await this.claimRepo.find({
            where: {
                listing_id: String(listingId),
                created_at: Between(
                    new Date(fromDate),
                    new Date(toDate)
                )
            }
        });
    }

    async exportClaimsToExcel(): Promise<Buffer> {
        const claims = await this.claimRepo.find();

        const formattedData = claims.map(claim => ({
            Status: claim.status,
            Listing: claim.listing_id,
            'Reservation ID': claim.reservation_id,
            'Reservation Amount': claim.reservation_amount,
            Channel: claim.channel,
            'Guest Name': claim.guest_name,
            'Guest Contact': claim.guest_contact_number,
            'Claim Notes': claim.description,
            'Final Price': claim.final_price
        }));

        const worksheet = XLSX.utils.json_to_sheet(formattedData);
        const csv = XLSX.utils.sheet_to_csv(worksheet);
    
        return Buffer.from(csv, 'utf-8');
    }

    async checkUnresolvedClaims() {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        const unresolvedClaims = await this.claimRepo.find({
            where: {
                status: Not('Completed'),
                created_at: LessThan(threeDaysAgo)
            }
        });

        for (const claim of unresolvedClaims) {
            await sendUnresolvedClaimEmail(claim);
        }
    }

    async getClaimsBasedOnDueDates() {
        const currentDate = format(new Date(), 'yyyy-MM-dd');
        const after1Day = format(addDays(new Date(), 1), 'yyyy-MM-dd');
        const after7Days = format(addDays(new Date(), 7), 'yyyy-MM-dd');

        const [dueToday, dueTomorrow, dueIn7Days] = await Promise.all([
            this.claimRepo.find({
                where: {
                    status: Equal('In Progress'),
                    due_date: Equal(currentDate),
                },
            }),
            this.claimRepo.find({
                where: {
                    status: Equal('In Progress'),
                    due_date: Equal(after1Day),
                },
            }),
            this.claimRepo.find({
                where: {
                    status: Equal('In Progress'),
                    due_date: Equal(after7Days),
                },
            }),
        ]);

        return {
            dueToday,
            dueTomorrow,
            dueIn7Days,
        };
    }

    async sendReminderMessageForClaims() {
        const claimsByDue = await this.getClaimsBasedOnDueDates();

        const dueTypes: Array<keyof typeof claimsByDue> = ['dueToday', 'dueTomorrow', 'dueIn7Days'];
        const dueTypeLabelMap: Record<keyof typeof claimsByDue, 'today' | 'tomorrow' | 'in7days'> = {
            dueToday: 'today',
            dueTomorrow: 'tomorrow',
            dueIn7Days: 'in7days',
        };

        for (const type of dueTypes) {
            const claims = claimsByDue[type];
            if (claims.length > 0) {
                await Promise.all(
                    claims.map((claim) => {
                        const message = buildClaimReminderMessage(claim, dueTypeLabelMap[type]);
                        return sendSlackMessage(message);
                    })
                );
            }
        }
    }

    async getClaimById(id: number) {
        const claim = await this.claimRepo.findOne({ where: { id } });
        if (!claim) {
            throw new Error('Claim not found');
        }
        return claim;
    }

} 