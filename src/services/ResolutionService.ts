import { Between, In, Raw, FindOptionsWhere } from "typeorm";
import { format, parse } from "date-fns";
import { Request } from "express";
import { Resolution } from "../entity/Resolution";
import { Listing } from "../entity/Listing";
import { appDatabase } from "../utils/database.util";

interface ResolutionQuery {
    listingId?: string;
    fromDate?: string;
    toDate?: string;
    category?: string;
    guestName?: string;
    page?: string;
    limit?: string;
}

interface ResolutionData {
    category: string;
    listingMapId: number;
    guestName: string;
    claimDate: string;
    amount: number;
}

export class ResolutionService {
    private resolutionRepo = appDatabase.getRepository(Resolution);
    private listingRepository = appDatabase.getRepository(Listing);

    async createResolution(data: ResolutionData, userId: string) {
        const resolution = new Resolution();
        resolution.category = data.category;
        resolution.listingMapId = data.listingMapId;
        resolution.guestName = data.guestName;
        resolution.claimDate = new Date(data.claimDate);
        resolution.amount = data.amount;
        resolution.userId = userId;
        resolution.createdAt = new Date();
        resolution.updatedAt = new Date();

        return await this.resolutionRepo.save(resolution);
    }

    async getResolutions(request: Request & { query: ResolutionQuery }, userId: string) {
        const {
            listingId,
            fromDate,
            toDate,
            category,
            guestName
        } = request.query;
        
        const page = Number(request.query.page) || 1;
        const limit = Number(request.query.limit) || 10;
        const skip = (page - 1) * limit;

        const resolutions = await this.resolutionRepo.find({
            where: {
                userId,
                ...(listingId && { listingMapId: Number(listingId) }),
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
            select: ["id", "address"],
            where: { id: In(listingMapIds) }
        });

        const listingNameMap = listings.reduce((acc, listing) => {
            acc[listing.id] = listing.address;
            return acc;
        }, {});

        const columns = [
            "ID",
            "Category",
            "Address",
            "Guest Name",
            "Claim Date",
            "Amount",
            "Created At"
        ];

        const rows = resolutions.map((resolution) => [
            resolution.id,
            resolution.category,
            listingNameMap[resolution.listingMapId] || 'N/A',
            resolution.guestName,
            format(resolution.claimDate, "yyyy-MM-dd"),
            resolution.amount,
            format(resolution.createdAt, "yyyy-MM-dd")
        ]);

        return {
            columns,
            rows
        };
    }

    async getResolutionById(resolutionId: number, userId: string) {
        const resolution = await this.resolutionRepo.findOne({
            where: { id: resolutionId, userId }
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
} 