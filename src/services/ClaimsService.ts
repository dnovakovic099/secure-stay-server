import { appDatabase } from "../utils/database.util";
import { Claim } from "../entity/Claim";
import { Between, Not, LessThan, In} from "typeorm";
import * as XLSX from 'xlsx';
import { sendUnresolvedClaimEmail } from "./ClaimsEmailService";
import { Listing } from "../entity/Listing";

export class ClaimsService {
    private claimRepo = appDatabase.getRepository(Claim);

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
        guestName?: string
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

        const [claims, total] = await this.claimRepo.findAndCount(queryOptions);

        return {
            data: claims,
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

        let updatedFileNames = [];
        if (claim.fileNames) {
            updatedFileNames = JSON.parse(claim.fileNames);
        }
        if (fileNames && fileNames.length > 0) {
            updatedFileNames = [...updatedFileNames, ...fileNames];
        }
        let listing_name = '';
        if (data.listing_id) {
            listing_name = (await appDatabase.getRepository(Listing).findOne({ where: { id: Number(data.listing_id) } }))?.internalListingName || "";
        }

        Object.assign(claim, {
            ...data,
            ...(data.listing_id && { listing_name: listing_name }),
            updated_by: userId,
            fileNames: JSON.stringify(updatedFileNames)
        });

        return await this.claimRepo.save(claim);
    }

    async deleteClaim(id: number) {
        return await this.claimRepo.delete(id);
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
} 