import { Between, ILike, In } from "typeorm";
import { Resolution } from "../entity/Resolution";
import { appDatabase } from "../utils/database.util";
import CustomErrorHandler from "../middleware/customError.middleware";
import { UsersEntity } from "../entity/Users";
import { haResolutionDeleteQueue, haResolutionQueue, haResolutionUpdateQueue } from "../queue/haQueue";
import logger from "../utils/logger.utils";
import { ListingService } from "./ListingService";
import fs from "fs";
import csv from "csv-parser";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { format, parse } from "date-fns";
import sendEmail from "../utils/sendEmai";
import { Listing } from "../entity/Listing";
import { formatCurrency } from "../helpers/helpers";
import { ResolutionCategory } from "../entity/ResolutionCategory";

interface ResolutionData {
    category: string;
    description?: string;
    listingMapId: number;
    reservationId: number;
    guestName: string;
    claimDate: string;
    amount: number;
    amountToPayout?: number | null;
    arrivalDate: string;
    departureDate: string;
    creationSource?: string;
    type?: string;
}

enum CategoryKey {
    CLAIM = 'claim',
    SECURITY_DEPOSIT = 'security_deposit',
    PET_FEE = 'pet_fee',
    EXTRA_CLEANING = 'extra_cleaning',
    OTHERS = 'others',
    RESOLUTION = 'resolution',
    REVIEW_REMOVAL = 'review_removal',
    DISPUTE = 'dispute'
}

const categoriesList: Record<CategoryKey, string> = {
    [CategoryKey.CLAIM]: "Claim",
    [CategoryKey.SECURITY_DEPOSIT]: "Security Deposit",
    [CategoryKey.PET_FEE]: "Pet Fee",
    [CategoryKey.EXTRA_CLEANING]: "Extra Cleaning",
    [CategoryKey.OTHERS]: "Others",
    [CategoryKey.RESOLUTION]: "Resolution",
    [CategoryKey.REVIEW_REMOVAL]: "Review Removal",
    [CategoryKey.DISPUTE]: "Dispute"
};

const defaultResolutionCategories = Object.entries(categoriesList).map(([categoryKey, name], index) => ({
    categoryKey,
    name,
    displayOrder: index + 1,
}));

const RESOLUTION_SORT_FIELD_MAP: Record<string, keyof Resolution> = {
    guestName: "guestName",
    listingName: "listingMapId",
    listingMapId: "listingMapId",
    propertyType: "listingMapId",
    serviceType: "listingMapId",
    category: "category",
    amount: "amount",
    amountToPayout: "amountToPayout",
    claimDate: "claimDate",
    arrivalDate: "arrivalDate",
    departureDate: "departureDate",
    description: "description",
    createdBy: "createdBy",
    updatedBy: "updatedBy",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
};

interface CsvRow {
    "Date": string;
    "Type": string;
    "Confirmation code": string;
    "Booking date": string;
    "Start date": string;
    "End date": string;
    "Guest": string;
    "Listing": string;
    "Amount": string;
    "Nights": string;
}

export class ResolutionService {
    private resolutionRepo = appDatabase.getRepository(Resolution);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private reservationInfoRepository = appDatabase.getRepository(ReservationInfoEntity);
    private listingInfoRepository = appDatabase.getRepository(Listing);
    private resolutionCategoryRepo = appDatabase.getRepository(ResolutionCategory);

    private normalizeSortRules(sort: any) {
        const sortItems = Array.isArray(sort) ? sort : sort ? Object.values(sort) : [];
        return sortItems
            .map((item: any) => ({
                field: String(item?.field || ""),
                direction: String(item?.direction || "asc").toLowerCase() === "desc" ? "desc" : "asc",
            }))
            .filter((item) => item.field)
            .slice(0, 3);
    }

    private extractTypeFromTags(tags: string | null | undefined, options: string[]) {
        if (!tags) return null;
        const tagList = tags.split(",").map(tag => tag.trim().toLowerCase());
        const match = options.find(option => tagList.includes(option.toLowerCase()));
        return match || null;
    }

    private extractPropertyType(listing?: any) {
        return this.extractTypeFromTags(listing?.tags, ["Own", "Arb", "PM"]) || listing?.propertyType || null;
    }

    private extractServiceType(listing?: any) {
        return this.extractTypeFromTags(listing?.tags, ["Full", "Pro", "Launch"]) || listing?.serviceType || null;
    }

    private normalizeCategoryKey(value: string) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
    }

    private async ensureResolutionCategories() {
        const count = await this.resolutionCategoryRepo.count();
        if (count > 0) return;

        await this.resolutionCategoryRepo.save(defaultResolutionCategories.map((category) => {
            const entity = new ResolutionCategory();
            entity.categoryKey = category.categoryKey;
            entity.name = category.name;
            entity.displayOrder = category.displayOrder;
            return entity;
        }));
    }

    async getResolutionCategories() {
        await this.ensureResolutionCategories();
        const categories = await this.resolutionCategoryRepo.find({
            order: {
                displayOrder: "ASC",
                name: "ASC",
            },
        });

        return categories.map((category) => ({
            id: category.categoryKey,
            categoryId: category.id,
            categoryKey: category.categoryKey,
            name: category.name,
            displayOrder: category.displayOrder,
        }));
    }

    async createResolutionCategory(body: { name?: string }) {
        const name = String(body.name || "").trim();
        if (!name) throw CustomErrorHandler.validationError("Category name is required.");

        let categoryKey = this.normalizeCategoryKey(name);
        if (!categoryKey) throw CustomErrorHandler.validationError("Category name is invalid.");

        const existing = await this.resolutionCategoryRepo.findOne({ where: { categoryKey } });
        if (existing) throw CustomErrorHandler.validationError("A category with this name already exists.");

        const maxOrder = await this.resolutionCategoryRepo
            .createQueryBuilder("category")
            .select("MAX(category.displayOrder)", "maxOrder")
            .getRawOne();

        const category = new ResolutionCategory();
        category.categoryKey = categoryKey;
        category.name = name;
        category.displayOrder = Number(maxOrder?.maxOrder || 0) + 1;
        await this.resolutionCategoryRepo.save(category);

        return this.getResolutionCategories();
    }

    async updateResolutionCategory(categoryKey: string, body: { name?: string }) {
        const category = await this.resolutionCategoryRepo.findOne({ where: { categoryKey } });
        if (!category) throw CustomErrorHandler.notFound("Resolution category not found.");

        const name = String(body.name || "").trim();
        if (!name) throw CustomErrorHandler.validationError("Category name is required.");

        category.name = name;
        await this.resolutionCategoryRepo.save(category);
        return this.getResolutionCategories();
    }

    async reorderResolutionCategories(body: { categoryIds?: string[] }) {
        const categoryIds = Array.isArray(body.categoryIds) ? body.categoryIds.map((id) => String(id).trim()).filter(Boolean) : [];
        if (categoryIds.length === 0) throw CustomErrorHandler.validationError("categoryIds is required.");

        const categories = await this.resolutionCategoryRepo.find();
        const categoryByKey = new Map(categories.map((category) => [category.categoryKey, category]));

        for (let index = 0; index < categoryIds.length; index += 1) {
            const category = categoryByKey.get(categoryIds[index]);
            if (category) {
                category.displayOrder = index + 1;
                await this.resolutionCategoryRepo.save(category);
            }
        }

        return this.getResolutionCategories();
    }

    async getResolutionCategoryUsage(categoryKey: string) {
        const usageCount = await this.resolutionRepo.count({ where: { category: categoryKey } });
        return { categoryId: categoryKey, usageCount };
    }

    async deleteResolutionCategory(categoryKey: string, body: { replacementCategoryId?: string }) {
        const category = await this.resolutionCategoryRepo.findOne({ where: { categoryKey } });
        if (!category) throw CustomErrorHandler.notFound("Resolution category not found.");

        const replacementCategoryId = String(body.replacementCategoryId || "").trim();
        if (!replacementCategoryId || replacementCategoryId === categoryKey) {
            throw CustomErrorHandler.validationError("A replacement category is required.");
        }

        const replacement = await this.resolutionCategoryRepo.findOne({ where: { categoryKey: replacementCategoryId } });
        if (!replacement) throw CustomErrorHandler.validationError("Replacement category was not found.");

        await this.resolutionRepo.update({ category: categoryKey }, { category: replacementCategoryId });
        await this.resolutionCategoryRepo.delete({ categoryKey });

        return this.getResolutionCategories();
    }

    async createResolution(data: ResolutionData, userId: string | null) {
        const resolution = new Resolution();
        resolution.category = data.category;
        resolution.description = data.description;
        resolution.listingMapId = data.listingMapId;
        resolution.reservationId = data.reservationId;
        resolution.guestName = data.guestName;
        resolution.claimDate = data.claimDate;
        resolution.amount = data.amount;
        resolution.amountToPayout = data.amountToPayout !== undefined ? data.amountToPayout : null;
        resolution.createdBy = userId ? userId : "system";
        resolution.arrivalDate = data.arrivalDate;
        resolution.departureDate = data.departureDate;
        resolution.creationSource = data.creationSource ? data.creationSource : "manual";
        resolution.type = data.type || null;

        await this.resolutionRepo.save(resolution);

        //add to queue to create resolution in HA
        // try {
        //     await haResolutionQueue.add('create-HA-resolution', {
        //         resolution,
        //     });
        // } catch (error) {
        //     logger.error(`Queueing Hostaway job failed for resolution ${resolution.id}: ${error.message}`);
        // }

        return resolution;
    }

    async updateResolution(updatedData: Partial<Resolution>, userId: string | null) {
        const resolution = await this.resolutionRepo.findOne({ where: { id: updatedData.id } });
        
        resolution.category = updatedData.category;
        resolution.description = updatedData.description;
        resolution.listingMapId = updatedData.listingMapId;
        resolution.reservationId = updatedData.reservationId;
        resolution.guestName = updatedData.guestName;
        resolution.claimDate = updatedData.claimDate;
        resolution.amount = updatedData.amount;
        resolution.updatedBy = userId ? userId : "system";
        resolution.arrivalDate = updatedData.arrivalDate;
        resolution.departureDate = updatedData.departureDate;
        resolution.amountToPayout = updatedData.amountToPayout;
        await this.resolutionRepo.save(resolution);

        //add to queue to update resolution in HA
        // if (resolution.ha_id) {
        //     try {
        //         await haResolutionUpdateQueue.add('update-HA-resolution', {
        //             resolution,
        //         });
        //     } catch (error) {
        //         logger.error(`Queueing Hostaway job failed for update resolution ${resolution.id}: ${error.message}`);
        //     }
        // }

        return resolution;
    }

    async getResolutions(filters: any) {
        const { listingId, reservationId, category, dateType, fromDate, toDate, page, limit, keyword, propertyType, sort } = filters;

        let listingIds = [];
        const listingService = new ListingService();

        if (propertyType && propertyType.length > 0) {
            listingIds = (await listingService.getListingsByPropertyTypes(propertyType as any)).map(l => l.id);
        } else {
            listingIds = listingId;
        }

        const baseWhere = {
            ...(listingIds && { listingMapId: In(listingIds) }),
            ...(reservationId && { reservationId: reservationId }),
            ...(category && category.length > 1 && { category: In(category) }),
            ...(dateType && { [`${dateType}`]: Between(String(fromDate), String(toDate)) }),
        }

        const where = keyword
        ? [
            { ...baseWhere, guestName: ILike(`%${keyword}%`) },
            { ...baseWhere, category: ILike(`%${keyword}%`) },
        ]
        : baseWhere;

        const sortRules = this.normalizeSortRules(sort);
        const order = sortRules.reduce((acc, rule) => {
            const field = RESOLUTION_SORT_FIELD_MAP[rule.field];
            if (field) acc[field] = rule.direction.toUpperCase() as "ASC" | "DESC";
            return acc;
        }, {} as Record<string, "ASC" | "DESC">);

        const [resolutions, total] = await this.resolutionRepo.findAndCount({
            where,
            skip: (page - 1) * limit,
            take: limit,
            order: Object.keys(order).length ? order : { id: "DESC" }
        })


        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));
        const listings = await appDatabase.query(`
              SELECT id, MIN(name) AS name, MIN(internalListingName) AS internalListingName, MIN(propertyType) AS propertyType, MIN(tags) AS tags
              FROM listing_info
              GROUP BY id
              `);

        const transformedResolutions = resolutions.map(resolution => {
            const listing = listings.find((listing) => listing.id == Number(resolution.listingMapId));
            return {
                ...resolution,
                listingName: listing?.internalListingName,
                propertyType: this.extractPropertyType(listing),
                serviceType: this.extractServiceType(listing),
                createdBy: userMap.get(resolution.createdBy) || resolution.createdBy,
                updatedBy: userMap.get(resolution.updatedBy) || resolution.updatedBy,
            };
        });

        return {
            resolutions: transformedResolutions,
            total
        }

    }

    async getResolutionById(resolutionId: number, userId: string) {
        const resolution = await this.resolutionRepo.findOne({ where: { id: resolutionId } });
        if (!resolution) {
            throw CustomErrorHandler.notFound(`Resolution with id ${resolutionId} not found`);
        }

        return resolution;
    }

    async deleteResolution(resolutionId: number, userId: string) {
        const resolution = await this.getResolutionById(resolutionId, userId);
        resolution.deletedAt = new Date();
        resolution.deletedBy = userId;
        await this.resolutionRepo.save(resolution);

        //add to queue to update resolution in HA
        // if (resolution.ha_id) {
        //     try {
        //         await haResolutionDeleteQueue.add('delete-HA-resolution', {
        //             resolution,
        //         });
        //     } catch (error) {
        //         logger.error(`Queueing Hostaway job failed for delete resolution ${resolution.id}: ${error.message}`);
        //     }
        // }

        return resolution
    }

    async getResolution(fromDate: string, toDate: string, listingId: number) {
        return await this.resolutionRepo.find({
            where: {
                claimDate: Between(fromDate, toDate),
                listingMapId: listingId
            }
        });
    }

    async getResolutionByReservationId(reservationId: number) {
        return await this.resolutionRepo.findOne({
            where: { 
                reservationId,
                category: "resolution"
             },
        });
    }

    async getResolutionsByReservationId(reservationId: number) {
        return await this.resolutionRepo.find({
            where: {
                reservationId,
                category: "Resolution"
            },
        });
    }

    async bulkUpdateResolutions(ids: number[], updateData: Partial<Resolution>, userId: string) {
        try {
            // Validate that all resolutions exist
            const existingResolutions = await this.resolutionRepo.find({
                where: { id: In(ids) }
            });

            if (existingResolutions.length !== ids.length) {
                const foundIds = existingResolutions.map(resolution => resolution.id);
                const missingIds = ids.filter(id => !foundIds.includes(id));
                throw new Error(`Resolutions with IDs ${missingIds.join(', ')} not found`);
            }

            // Update all resolutions with the provided data
            const updatePromises = existingResolutions.map(resolution => {
                // Only update fields that are provided in updateData
                if (updateData.category !== undefined) {
                    resolution.category = updateData.category;
                }
                if (updateData.description !== undefined) {
                    resolution.description = updateData.description;
                }
                if (updateData.listingMapId !== undefined) {
                    resolution.listingMapId = updateData.listingMapId;
                }
                if (updateData.guestName !== undefined) {
                    resolution.guestName = updateData.guestName;
                }
                if (updateData.reservationId !== undefined) {
                    resolution.reservationId = updateData.reservationId;
                }
                if (updateData.claimDate !== undefined) {
                    resolution.claimDate = updateData.claimDate;
                }
                if (updateData.amount !== undefined) {
                    resolution.amount = updateData.amount;
                }
                if (updateData.arrivalDate !== undefined) {
                    resolution.arrivalDate = updateData.arrivalDate;
                }
                if (updateData.departureDate !== undefined) {
                    resolution.departureDate = updateData.departureDate;
                }
                if (updateData.amountToPayout !== undefined) {
                    resolution.amountToPayout = updateData.amountToPayout;
                }
                
                resolution.updatedBy = userId;
                return this.resolutionRepo.save(resolution);
            });

            const updatedResolutions = await Promise.all(updatePromises);
            
            // Add to queue to update resolutions in HA for those that have ha_id
            // const resolutionsWithHaId = updatedResolutions.filter(resolution => resolution.ha_id);
            // for (const resolution of resolutionsWithHaId) {
            //     try {
            //         await haResolutionUpdateQueue.add('update-HA-resolution', {
            //             resolution,
            //         });
            //     } catch (error) {
            //         logger.error(`Queueing Hostaway job failed for bulk update resolution ${resolution.id}: ${error.message}`);
            //     }
            // }
            
            return {
                success: true,
                updatedCount: updatedResolutions.length,
                message: `Successfully updated ${updatedResolutions.length} resolutions`
            };
        } catch (error) {
            throw error;
        }
    }

    async processCSVData(filePath: string): Promise<CsvRow[]> {
        const allowedTypes = [
            "Resolution Adjustment",
            "Resolution Payout",
            "Cancellation Fee",
            "Cancellation Fee Refund",
        ];

        return new Promise((resolve, reject) => {
            const results: CsvRow[] = [];

            fs.createReadStream(filePath)
                .pipe(csv({
                    mapHeaders: ({ header }) => header.replace(/^\uFEFF/, "").trim()
                }))
                .on("headers", (headers: string[]) => {
                    // ✅ validate headers once, not per row
                    const requiredHeaders = ["Guest", "Start date", "Amount", "Nights", "Type", "Date", "Confirmation code"];
                    const missing = requiredHeaders.filter(h => !headers.includes(h));
                    if (missing.length > 0) {
                        fs.unlinkSync(filePath);
                        reject(new CustomErrorHandler(400, `Missing required headers in the CSV file: ${missing.join(", ")}`));
                    }
                })
                .on("data", (data: CsvRow) => {
                    try {
                        if (!allowedTypes.includes(data.Type)) return;

                        const rawDate = data["Date"]?.trim();
                        if (!rawDate) return;

                        // parse CSV "Date" (assuming in MM/dd/yyyy format)
                        const parsedDate = parse(rawDate, "MM/dd/yyyy", new Date());

                        // format to yyyy-MM-dd for comparison
                        const formattedDate = format(parsedDate, "yyyy-MM-dd");

                        const startDate = "2025-09-01";

                        //get 30 days back date from current date
                        const date30DaysAgo = new Date();
                        date30DaysAgo.setDate(date30DaysAgo.getDate() - 30);
                        const past30Date = format(date30DaysAgo, "yyyy-MM-dd");

                        if (formattedDate >= past30Date) {
                            results.push(data);
                        }
                    } catch (err) {
                        // skip rows with invalid date format
                        logger.warn(`Skipping row with invalid date: ${JSON.stringify(data)}`);
                    }
                })
                .on("end", () => {
                    resolve(results);
                })
                .on("error", (err) => {
                    fs.unlinkSync(filePath);
                    reject(err);
                });
        });
    }


    async processCSVFileForResolution(filePath: string, userId: string) {
        const filteredRows = await this.processCSVData(filePath);
        const failedToProcessData: (CsvRow & { reason?: string; })[] = [];
        const successfullyProcessedData: CsvRow[] = [];

        if (filteredRows.length === 0) {
            fs.unlinkSync(filePath); // Delete the file after processing
            return { successfullyProcessedData, failedToProcessData };
        }

        for (const row of filteredRows) {
            const confirmationCode = row["Confirmation code"]?.trim();

            // ✅ Defensive checks for missing/empty values
            const claimDateRaw = row.Date;
            const amountRaw = row.Amount;

            if (!confirmationCode || !amountRaw || !claimDateRaw) {
                failedToProcessData.push({ ...row, reason: "Missing required data" });
                logger.warn(`Skipping row due to missing data: ${JSON.stringify(row)}`);
                continue;
            }

            let claimDate: string | null = null;

            try {
                if (claimDateRaw) {
                    claimDate = format(
                        claimDateRaw,
                        "yyyy-MM-dd"
                    );
                }
            } catch (err) {
                failedToProcessData.push({ ...row, reason: "Invalid date format" });
                logger.warn(`Invalid date format for row: ${JSON.stringify(row)}`);
                continue;
            }

            const reservation = await this.reservationInfoRepository.findOne({
                where: { channelReservationId: confirmationCode }
            });
            if (!reservation) {
                failedToProcessData.push({ ...row, reason: "No matching reservation found" });
                logger.warn(`No reservation found for confirmation code: ${confirmationCode}`);
                continue;
            }

            const resolutionData: ResolutionData = {
                category: CategoryKey.RESOLUTION,
                type: row.Type,
                listingMapId: reservation.listingMapId, 
                reservationId: reservation.id, 
                guestName: reservation.guestName,
                claimDate: claimDate ? claimDate : format(new Date(), "yyyy-MM-dd"),
                amount: Number(row.Amount), 
                arrivalDate: String(reservation.arrivalDate),
                departureDate: String(reservation.departureDate),
                creationSource: "csv_upload"
            };

            let cancellationFeeInfo = null;
            const existingResolutions = await this.getResolutionsByReservationId(reservation.id);
            const hasExistingResolution = existingResolutions.some(res => (res.amount == Number(row.Amount) && (res.type == row.Type || res.description == row.Type)));
            if (hasExistingResolution) {
                // failedToProcessData.push(row);
                logger.warn(`Skipping duplicate resolution for reservation ID ${reservation.id} with amount ${row.Amount} and type ${row.Type}`);
                continue;
            }

            if (row.Type === "Cancellation Fee Refund") {
                cancellationFeeInfo = existingResolutions.filter(res => (Math.abs(res.amount) == Math.abs(Number(row.Amount)) && (res.type == "Cancellation Fee" || res.description =="Cancellation Fee")));
            }

            const resolution = await this.createResolution(resolutionData, userId);
            successfullyProcessedData.push(row);
            if (cancellationFeeInfo && cancellationFeeInfo?.length == 1) {
                // send email notification
                this.sendCancellationFeeNotification(reservation, resolution, cancellationFeeInfo[0]);
                logger.info(`Cancellation Fee Refund processed for reservation ID ${reservation.id} with existing Cancellation Fee.`);
            }
        }

        fs.unlinkSync(filePath); // Delete the file after processing

        return { successfullyProcessedData, failedToProcessData };
    }

    async checkCSVFileForMissingResolutions(filePath: string) {
        const filteredRows = await this.processCSVData(filePath);
        const missingRows: (CsvRow & { reason?: string; })[] = [];
        const presentRows: CsvRow[] = [];

        if (filteredRows.length === 0) {
            fs.unlinkSync(filePath);
            return { missingRows, presentRows };
        }

        for (const row of filteredRows) {
            const confirmationCode = row["Confirmation code"]?.trim();
            const claimDateRaw = row.Date;
            const amountRaw = row.Amount;

            if (!confirmationCode || !amountRaw || !claimDateRaw) {
                missingRows.push({ ...row, reason: "Missing required data" });
                continue;
            }

            const reservation = await this.reservationInfoRepository.findOne({
                where: { channelReservationId: confirmationCode }
            });
            if (!reservation) {
                missingRows.push({ ...row, reason: "No matching reservation found" });
                continue;
            }

            const existingResolutions = await this.getResolutionsByReservationId(reservation.id);
            const hasExistingResolution = existingResolutions.some(res =>
                (res.amount == Number(row.Amount) && (res.type == row.Type || res.description == row.Type))
            );

            if (hasExistingResolution) {
                presentRows.push(row);
            } else {
                missingRows.push({ ...row, reason: "Resolution not found in database" });
            }
        }

        fs.unlinkSync(filePath);

        return { missingRows, presentRows };
    }

    async checkCancellationFeesWithoutRefunds(filePath: string): Promise<CsvRow[]> {
        return new Promise((resolve, reject) => {
            const allRows: CsvRow[] = [];

            fs.createReadStream(filePath)
                .pipe(csv({
                    mapHeaders: ({ header }) => header.replace(/^﻿/, "").trim()
                }))
                .on("headers", (headers: string[]) => {
                    const required = ["Guest", "Start date", "Type", "Confirmation code"];
                    const missing = required.filter(h => !headers.includes(h));
                    if (missing.length > 0) {
                        fs.unlinkSync(filePath);
                        reject(new CustomErrorHandler(400, `Missing required headers: ${missing.join(", ")}`));
                    }
                })
                .on("data", (row: CsvRow) => {
                    if (row.Type === "Cancellation Fee" || row.Type === "Cancellation Fee Refund") {
                        allRows.push(row);
                    }
                })
                .on("end", () => {
                    const groupMap = new Map<string, { fees: CsvRow[]; refunds: CsvRow[] }>();
                    for (const row of allRows) {
                        const key = row["Confirmation code"]?.trim() || `${row.Guest?.trim()}_${row["Start date"]?.trim()}`;
                        if (!groupMap.has(key)) groupMap.set(key, { fees: [], refunds: [] });
                        const group = groupMap.get(key)!;
                        if (row.Type === "Cancellation Fee") {
                            group.fees.push(row);
                        } else {
                            group.refunds.push(row);
                        }
                    }
                    const result: CsvRow[] = [];
                    for (const { fees, refunds } of groupMap.values()) {
                        if (fees.length > 0 && refunds.length === 0) result.push(...fees);
                    }
                    fs.unlinkSync(filePath);
                    resolve(result);
                })
                .on("error", (err) => {
                    fs.unlinkSync(filePath);
                    reject(err);
                });
        });
    }

    async sendCancellationFeeNotification(reservation: ReservationInfoEntity, resolution: Resolution, cancellationFeeInfo: Resolution) {
        const listingInfo = await this.listingInfoRepository.findOne({ where: { id: reservation.listingMapId } });

        let searchKey = "";
        const channelReservationId = reservation?.channelReservationId;
        const searchKeys = channelReservationId.split('-');
        if (searchKeys && searchKeys.length > 0) {
            searchKey = searchKeys[searchKeys.length - 1];
        }

        let subject = `Airbnb Cancellation Fee Refund Processed for ${reservation?.guestName} - ${searchKey} `;

        const html = `
                <html>
                  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); padding: 20px;">
                      <h2 style="color: #007BFF; border-bottom: 2px solid #007BFF; padding-bottom: 10px;">Airbnb Cancellation Fee Refund</h2>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Guest Name:</strong> ${reservation?.guestName}
                      </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Check-In:</strong> ${reservation?.arrivalDate}
                      </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                          <strong>Check-Out:</strong> ${reservation?.departureDate}
                        </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                          <strong>Listing:</strong> ${listingInfo?.internalListingName}
                        </p>
                        <p style="margin: 20px 0; font-size: 16px;">
                          <strong>Amount:</strong> ${formatCurrency(resolution.amount)}
                        </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                          <strong>Date (Cancellation Fee):</strong> ${cancellationFeeInfo.claimDate}
                        </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Date (Cancellation Fee Refund):</strong> ${resolution.claimDate}
                      </p>
                      <p style="margin: 30px 0 0; font-size: 14px; color: #777;">Thank you!</p>
                    </div>
                  </body>
                </html>

        `;

        const receipientsList = [
            "ferdinand@luxurylodgingpm.com",
            "receipts@luxurylodgingstr.com"
        ];

        const results = await Promise.allSettled(
            receipientsList.map(receipient =>
                sendEmail(subject, html, process.env.EMAIL_FROM, receipient)
            )
        );

        results.forEach((result, index) => {
            if (result.status === "rejected") {
                logger.error(`Failed to send email to recipient #${index}`, result?.reason);
            }
        });

    }
}
