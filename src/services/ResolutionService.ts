import { Between, In } from "typeorm";
import { format } from "date-fns";
import { Request } from "express";
import { Resolution } from "../entity/Resolution";
import { Listing } from "../entity/Listing";
import { appDatabase } from "../utils/database.util";
import CustomErrorHandler from "../middleware/customError.middleware";
import { UsersEntity } from "../entity/Users";

interface ResolutionQuery {
    listingId?: number[];
    fromDate?: string;
    toDate?: string;
    category?: string[];
    reservationId?: number;
    page: number;
    limit: number;
    dateType: string;
}

interface ResolutionData {
    category: string;
    description?: string;
    listingMapId: number;
    reservationId: number;
    guestName: string;
    claimDate: string;
    amount: number;
    arrivalDate: string;
    departureDate: string;
}

enum CategoryKey {
    CLAIM = 'claim',
    SECURITY_DEPOSIT = 'security_deposit',
    PET_FEE = 'pet_fee',
    EXTRA_CLEANING = 'extra_cleaning',
    OTHERS = 'others',
    RESOLUTION = 'resolution',
    REVIEW_REMOVAL = 'review_removal'
}

const categoriesList: Record<CategoryKey, string> = {
    [CategoryKey.CLAIM]: "Claim",
    [CategoryKey.SECURITY_DEPOSIT]: "Security Deposit",
    [CategoryKey.PET_FEE]: "Pet Fee",
    [CategoryKey.EXTRA_CLEANING]: "Extra Cleaning",
    [CategoryKey.OTHERS]: "Others",
    [CategoryKey.RESOLUTION]: "Resolution",
    [CategoryKey.REVIEW_REMOVAL]: "Review Removal"
};

export class ResolutionService {
    private resolutionRepo = appDatabase.getRepository(Resolution);
    private usersRepo = appDatabase.getRepository(UsersEntity);

    async createResolution(data: ResolutionData, userId: string | null) {
        const resolution = new Resolution();
        resolution.category = data.category;
        resolution.description = data.description;
        resolution.listingMapId = data.listingMapId;
        resolution.reservationId = data.reservationId;
        resolution.guestName = data.guestName;
        resolution.claimDate = new Date(data.claimDate);
        resolution.amount = data.amount;
        resolution.createdBy = userId ? userId : "system";
        resolution.arrivalDate = data.arrivalDate;
        resolution.departureDate = data.departureDate;

        return await this.resolutionRepo.save(resolution);
    }

    async updateResolution(updatedData: Partial<Resolution>, userId: string | null) {
        const resolution = await this.resolutionRepo.findOne({ where: { id: updatedData.id } });
        
        resolution.category = updatedData.category;
        resolution.description = updatedData.description;
        resolution.listingMapId = updatedData.listingMapId;
        resolution.reservationId = updatedData.reservationId;
        resolution.guestName = updatedData.guestName;
        resolution.claimDate = new Date(updatedData.claimDate);
        resolution.amount = updatedData.amount;
        resolution.updatedBy = userId ? userId : "system";
        resolution.arrivalDate = updatedData.arrivalDate;
        resolution.departureDate = updatedData.departureDate;
        resolution.amountToPayout = resolution.amountToPayout;

        return await this.resolutionRepo.save(resolution);
    }

    async getResolutions(filters: any) {
        const { listingId, reservationId, category, dateType, fromDate, toDate, page, limit } = filters;
        const [resolutions, total] = await this.resolutionRepo.findAndCount({
            where: {
                ...(listingId && { listingMapId: In(listingId) }),
                ...(reservationId && { reservationId: reservationId }),
                ...(category && category.length > 1 && { category: In(category) }),
                [`${dateType}`]: Between(String(fromDate), String(toDate)),
            },
            skip: (page - 1) * limit,
            take: limit,
        })


        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));
        const listings = await appDatabase.query(`
              SELECT id, MIN(name) AS name, MIN(internalListingName) AS internalListingName
              FROM listing_info
              GROUP BY id
              `);

        const transformedResolutions = resolutions.map(resolution => {
            return {
                ...resolution,
                listingName: listings.find((listing) => listing.id == Number(resolution.listingMapId))?.internalListingName,
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
        return await this.resolutionRepo.save(resolution);
    }

    async getResolution(fromDate: string, toDate: string, listingId: number) {
        return await this.resolutionRepo.find({
            where: {
                claimDate: Between(
                    new Date(fromDate),
                    new Date(toDate)
                ),
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
} 