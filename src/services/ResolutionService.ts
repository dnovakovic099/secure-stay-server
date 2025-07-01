import { Between, In } from "typeorm";
import { format } from "date-fns";
import { Request } from "express";
import { Resolution } from "../entity/Resolution";
import { Listing } from "../entity/Listing";
import { appDatabase } from "../utils/database.util";

interface ResolutionQuery {
    listingId?: string;
    fromDate?: string;
    toDate?: string;
    categories?: string;
    guestName?: string;
    page?: string;
    limit?: string;
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
    private listingRepository = appDatabase.getRepository(Listing);

    async createResolution(data: ResolutionData, userId: string | null) {
        const resolution = new Resolution();
        resolution.category = data.category;
        resolution.description = data.description;
        resolution.listingMapId = data.listingMapId;
        resolution.reservationId = data.reservationId;
        resolution.guestName = data.guestName;
        resolution.claimDate = new Date(data.claimDate);
        resolution.amount = data.amount;
        resolution.createdAt = new Date();
        resolution.updatedAt = new Date();
        resolution.createdBy = userId;
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
        resolution.updatedBy = userId;
        resolution.arrivalDate = updatedData.arrivalDate;
        resolution.departureDate = updatedData.departureDate;

        return await this.resolutionRepo.save(resolution);
    }

    async getResolutions(request: Request & { query: ResolutionQuery }, userId: string) {
        const {
            listingId,
            fromDate,
            toDate,
            categories,
        } = request.query;
        
        const page = Number(request.query.page) || 1;
        const limit = Number(request.query.limit) || 10;
        const skip = (page - 1) * limit;

        const categoryArray = categories 
        ? categories.split(',').filter(cat => Object.values(CategoryKey).includes(cat as CategoryKey))
        : null;

        const resolutions = await this.resolutionRepo.find({
            where: {
                ...(listingId && { listingMapId: Number(listingId) }),
                ...(categoryArray?.length && { 
                    category: In(categoryArray)
                }),
                ...(fromDate && toDate && {
                    claimDate: Between(
                        new Date(String(fromDate)),
                        new Date(String(toDate))
                    )
                }),
            },
            order: { createdAt: "DESC" },
            skip,
            take: limit,
        });

        const listingMapIds = resolutions
            .map(resolution => resolution.listingMapId)
            .filter((id, index, self) => id != null && self.indexOf(id) === index);

        const listings = await this.listingRepository.find({
            select: ["id", "address", "internalListingName"],
            where: { id: In(listingMapIds) }
        });

        const listingNameMap = listings.reduce((acc, listing) => {
            acc[listing.id] = listing.internalListingName;
            return acc;
        }, {});

        const columns = [
            "ID",
            "Category",
            "Description",
            "Listing",
            "Guest Name",
            "Claim Date",
            "Amount",
            "Check In",
            "Check Out",
            "Created At"
        ];

        const rows = resolutions.map((resolution) => [
            resolution.id,
            categoriesList[resolution.category as CategoryKey] ?? 'Unknown Category',
            resolution.description ?? 'N/A',
            listingNameMap[resolution.listingMapId] || 'N/A',
            resolution.guestName,
            format(resolution.claimDate, "yyyy-MM-dd"),
            Number(resolution.amount),
            resolution.arrivalDate,
            resolution.departureDate,
            format(resolution.createdAt, "yyyy-MM-dd"),
        ]);

        return {
            columns,
            rows
        };
    }

    async getResolutionById(resolutionId: number, userId: string) {
        const resolution = await this.resolutionRepo.findOne({
            where: { id: resolutionId, createdBy: userId }
        });

        if (!resolution) {
            throw new Error('Resolution not found');
        }

        return resolution;
    }

    async deleteResolution(resolutionId: number, userId: string) {
        const resolution = await this.getResolutionById(resolutionId, userId);
        await this.resolutionRepo.remove(resolution);
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