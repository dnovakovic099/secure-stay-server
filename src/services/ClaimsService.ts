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
import { FileInfo } from "../entity/FileInfo";
import logger from "../utils/logger.utils";

export class ClaimsService {
    private claimRepo = appDatabase.getRepository(Claim);
    private usersRepo = appDatabase.getRepository(UsersEntity); 
    private fileInfoRepo = appDatabase.getRepository(FileInfo);

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async createClaim(data: Partial<Claim>, userId: string, fileInfo?: { fileName: string, filePath: string, mimeType: string; originalName: string; }[]) {
        const listing_name = (await appDatabase.getRepository(Listing).findOne({ where: { id: Number(data.listing_id) } }))?.internalListingName || ""

        const newClaim = this.claimRepo.create({
            ...data,
            listing_name: listing_name,
            fileNames: fileInfo ? JSON.stringify(fileInfo.map(file => file.fileName)) : "",
            created_by: userId,
        });

        const savedClaim = await this.claimRepo.save(newClaim);
        if (fileInfo) {
            for (const file of fileInfo) {
                const fileRecord = new FileInfo();
                fileRecord.entityType = 'claims';
                fileRecord.entityId = savedClaim.id;
                fileRecord.fileName = file.fileName;
                fileRecord.createdBy = userId;
                fileRecord.localPath = file.filePath;
                fileRecord.mimetype = file.mimeType;
                fileRecord.originalName = file.originalName;
                await this.fileInfoRepo.save(fileRecord);
            }
        }
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

        const fileInfoList = await this.fileInfoRepo.find({ where: { entityType: 'claims' } });

        const [claims, total] = await this.claimRepo.findAndCount(queryOptions);

        const transformedData = claims.map(claim => {
            return {
                ...claim,
                updated_by: userMap.get(claim.updated_by) || claim.updated_by,
                fileInfo: fileInfoList.filter(file => file.entityId === claim.id)
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

    async updateClaim(id: number, data: Partial<Claim>, userId: string, fileInfo?: { fileName: string, filePath: string, mimeType: string; originalName: string; }[]) {
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

        const updatedData = await this.claimRepo.save(claim);
        if (fileInfo) {
            for (const file of fileInfo) {
                const fileRecord = new FileInfo();
                fileRecord.entityType = 'claims';
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

    async bulkUpdateClaims(ids: number[], updateData: Partial<Claim>, userId: string) {
        try {
            // Validate that all claims exist
            const existingClaims = await this.claimRepo.find({
                where: { id: In(ids) }
            });

            if (existingClaims.length !== ids.length) {
                const foundIds = existingClaims.map(claim => claim.id);
                const missingIds = ids.filter(id => !foundIds.includes(id));
                throw new Error(`Claims with IDs ${missingIds.join(', ')} not found`);
            }

            // Update all claims with the provided data
            const updatePromises = existingClaims.map(claim => {
                // Only update fields that are provided in updateData
                if (updateData.status !== undefined) {
                    claim.status = updateData.status;
                }
                if (updateData.listing_id !== undefined) {
                    claim.listing_id = updateData.listing_id;
                }
                if (updateData.listing_name !== undefined) {
                    claim.listing_name = updateData.listing_name;
                }
                if (updateData.description !== undefined) {
                    claim.description = updateData.description;
                }
                if (updateData.reservation_id !== undefined) {
                    claim.reservation_id = updateData.reservation_id;
                }
                if (updateData.reservation_amount !== undefined) {
                    claim.reservation_amount = updateData.reservation_amount;
                }
                if (updateData.channel !== undefined) {
                    claim.channel = updateData.channel;
                }
                if (updateData.guest_name !== undefined) {
                    claim.guest_name = updateData.guest_name;
                }
                if (updateData.guest_contact_number !== undefined) {
                    claim.guest_contact_number = updateData.guest_contact_number;
                }
                if (updateData.quote_1 !== undefined) {
                    claim.quote_1 = updateData.quote_1;
                }
                if (updateData.quote_2 !== undefined) {
                    claim.quote_2 = updateData.quote_2;
                }
                if (updateData.quote_3 !== undefined) {
                    claim.quote_3 = updateData.quote_3;
                }
                if (updateData.estimated_reasonable_price !== undefined) {
                    claim.estimated_reasonable_price = updateData.estimated_reasonable_price;
                }
                if (updateData.final_price !== undefined) {
                    claim.final_price = updateData.final_price;
                }
                if (updateData.client_paid_amount !== undefined) {
                    claim.client_paid_amount = updateData.client_paid_amount;
                }
                if (updateData.claim_resolution_amount !== undefined) {
                    claim.claim_resolution_amount = updateData.claim_resolution_amount;
                }
                if (updateData.payment_information !== undefined) {
                    claim.payment_information = updateData.payment_information;
                }
                if (updateData.reporter !== undefined) {
                    claim.reporter = updateData.reporter;
                }
                if (updateData.reservation_link !== undefined) {
                    claim.reservation_link = updateData.reservation_link;
                }
                if (updateData.client_requested_amount !== undefined) {
                    claim.client_requested_amount = updateData.client_requested_amount;
                }
                if (updateData.airbnb_filing_amount !== undefined) {
                    claim.airbnb_filing_amount = updateData.airbnb_filing_amount;
                }
                if (updateData.airbnb_resolution !== undefined) {
                    claim.airbnb_resolution = updateData.airbnb_resolution;
                }
                if (updateData.airbnb_resolution_won_amount !== undefined) {
                    claim.airbnb_resolution_won_amount = updateData.airbnb_resolution_won_amount;
                }
                if (updateData.payee !== undefined) {
                    claim.payee = updateData.payee;
                }
                if (updateData.payment_status !== undefined) {
                    claim.payment_status = updateData.payment_status;
                }
                if (updateData.due_date !== undefined) {
                    claim.due_date = updateData.due_date;
                }
                if (updateData.claim_type !== undefined) {
                    claim.claim_type = updateData.claim_type;
                }
                if (updateData.reservation_code !== undefined) {
                    claim.reservation_code = updateData.reservation_code;
                }
                
                claim.updated_by = userId;
                return this.claimRepo.save(claim);
            });

            const updatedClaims = await Promise.all(updatePromises);
            
            return {
                success: true,
                updatedCount: updatedClaims.length,
                message: `Successfully updated ${updatedClaims.length} claims`
            };
        } catch (error) {
            throw error;
        }
    }

    async migrateFilesToDrive() {
        //get all claims
        const claims = await this.claimRepo.find();
        const fileInfo = await this.fileInfoRepo.find({ where: { entityType: 'claims' } });

        for (const claim of claims) {
            try {
                if (claim.fileNames) {
                    const fileNames = JSON.parse(claim.fileNames) as string[];
                    const filesForClaim = fileInfo.filter(file => file.entityId === claim.id);
                    for (const file of fileNames) {
                        const fileExists = filesForClaim.find(f => f.fileName === file);
                        if (!fileExists) {
                            const fileRecord = new FileInfo();
                            fileRecord.entityType = 'claims';
                            fileRecord.entityId = claim.id;
                            fileRecord.fileName = file;
                            fileRecord.createdBy = claim.created_by;
                            fileRecord.localPath = `${process.cwd()}/dist/public/claims/${file}`;
                            fileRecord.mimetype = null;
                            fileRecord.originalName = null;
                            await this.fileInfoRepo.save(fileRecord);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Error migrating files for claim ID ${claim.id}: ${error.message}`);
            }
        }
    }

} 