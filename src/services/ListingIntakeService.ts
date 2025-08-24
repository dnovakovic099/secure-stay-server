import { appDatabase } from "../utils/database.util";
import { ListingIntake } from "../entity/ListingIntake";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ILike, In } from "typeorm";
import { UsersEntity } from "../entity/Users";
import { ListingIntakeBedTypes } from "../entity/ListingIntakeBedTypes";
import logger from "../utils/logger.utils";
import { max } from "date-fns";
import { HostAwayClient } from "../client/HostAwayClient";

interface ListingIntakeFilter {
    status: string[];
    clientContact: string;
    clientName: string;
    page: number;
    limit: number;
}

export class ListingIntakeService {
    private listingIntakeRepo = appDatabase.getRepository(ListingIntake);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingIntakeBedTypesRepo = appDatabase.getRepository(ListingIntakeBedTypes);
    private hostawayClient = new HostAwayClient();

    async createListingIntake(body: Partial<ListingIntake>, userId: string) {
        const listingIntake = this.listingIntakeRepo.create({
            ...body,
            status: "draft"
        });
        return await this.listingIntakeRepo.save(listingIntake);
    }

    async updateListingIntake(body: Partial<ListingIntake>, userId: string) {
        const listingIntake = await this.listingIntakeRepo.findOne({ where: { id: body.id } });
        if (!listingIntake) {
            throw CustomErrorHandler.notFound(`Listing intake with id ${body.id} not found`);
        }
        const { id, ...rest } = body;

        const updatedData = this.listingIntakeRepo.merge(listingIntake, {
            ...rest,
            updatedBy: userId
        });

        return await this.listingIntakeRepo.update({ id: body.id }, updatedData);
    }

    async deleteListingIntake(id: number, userId: string) {
        const listingIntake = await this.listingIntakeRepo.findOneBy({ id });
        if (!listingIntake) {
            throw CustomErrorHandler.notFound(`Listing intake with ID ${id} not found.`);
        }

        listingIntake.deletedBy = userId;
        listingIntake.deletedAt = new Date();

        return await this.listingIntakeRepo.save(listingIntake);
    }

    async getListingIntake(filter: ListingIntakeFilter, userId: string) {
        const { status, clientContact, clientName, page, limit } = filter;
        let whereConditions = {
            ...(status && status.length > 0 && { listingId: In(status) }),
            ...(clientName && { clientName: ILike(`%${clientName}%`) }),
            ...(clientContact && { clientContact: ILike(`%${clientContact}%`) })
        };

        const [listingIntakes, total] = await this.listingIntakeRepo.findAndCount({
            where: whereConditions,
            order: { createdAt: "DESC" },
            take: limit,
            skip: (page - 1) * limit
        });

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));

        const transformedListingIntakes = listingIntakes.map(logs => {
            return {
                ...logs,
                createdBy: userMap.get(logs.createdBy) || logs.createdBy,
                updatedBy: userMap.get(logs.updatedBy) || logs.updatedBy,
            };
        });

        return { listingIntakes: transformedListingIntakes, total };

    }

    async getListingIntakeById(id: number) {
        const listingIntake = await this.listingIntakeRepo.findOne({ where: { id: id }, relations: ["listingBedTypes"] });
        if (!listingIntake) {
            throw CustomErrorHandler.notFound(`Listing intake with ID ${id} not found.`);
        }
        listingIntake.status = this.getListingIntakeStatus(listingIntake);

        return await this.listingIntakeRepo.save(listingIntake);
    }

    private getListingIntakeStatus(listingIntake: ListingIntake) {
        const requiredFields = [
            "externalListingName",
            "address",
            "price",
            "guestsIncluded",
            "priceForExtraPerson",
            "currencyCode"
        ];

        const hasMissingValue = requiredFields.some(field => {
            const value = (listingIntake as any)[field];
            return value == null || value === "";
        });

        return hasMissingValue ? "draft" : "ready";
    }


    async saveBedTypes(body: Partial<ListingIntakeBedTypes>[]) {
        const bedTypes = this.listingIntakeBedTypesRepo.create(body);
        return await this.listingIntakeBedTypesRepo.save(bedTypes);
    }

    async updateBedTypes(body: Partial<ListingIntakeBedTypes>[]) {
        return await this.listingIntakeBedTypesRepo.save(body);
    }

    async getBedTypes(listingIntakeId: number) {
        return await this.listingIntakeBedTypesRepo.find({ where: { listingIntakeId: listingIntakeId } });
    }

    async deleteBedTypes(body: Partial<ListingIntakeBedTypes>[]) {
        const ids = body
            .map(bedType => bedType.id)
            .filter((id): id is number => !!id); // filter out undefined/null

        await this.listingIntakeBedTypesRepo.delete(ids);
        return { message: "Bed types deleted successfully", deletedIds: ids };
    }

    //publish listingIntake to hostaway
    async publishListingIntakeToHostaway(listingIntakeId: number, userId: string) {
        const listingIntake = await this.listingIntakeRepo.findOne({
            where: { id: listingIntakeId },
            relations: ["listingBedTypes"]
        });

        if (!listingIntake) {
            throw CustomErrorHandler.notFound(`Listing intake with ID ${listingIntakeId} not found.`);
        }

        // Here you would implement the logic to publish the listingIntake to Hostaway
        // This is a placeholder for the actual implementation
        logger.info("Publishing listing intake to Hostaway:", listingIntake);

        // Simulate successful publishing
        let status = this.getListingIntakeStatus(listingIntake);
        if (status === "draft") {
            throw CustomErrorHandler.forbidden("Listing intake is in draft status and cannot be published to Hostaway.");
        }
        if (status === "published") {
            throw CustomErrorHandler.forbidden("Listing intake is already published to Hostaway.");
        }

        //prepare hostaway payload
        const hostawayPayload = {
            externalListingName: listingIntake.externalListingName,
            description: listingIntake.description,
            personCapacity: listingIntake.personCapacity,
            propertyTypeId: listingIntake.propertyTypeId,
            roomType: listingIntake.roomType,
            bedroomsNumber: listingIntake.bedroomsNumber,
            bedsNumber: listingIntake.bedsNumber,
            bathroomsNumber: listingIntake.bathroomsNumber,
            bathroomType: listingIntake.bathroomType,
            guestBathroomsNumber: listingIntake.guestBathroomsNumber,
            address: listingIntake.address,
            publicAddress: listingIntake.publicAddress,
            country: listingIntake.country,
            countryCode: listingIntake.countryCode,
            state: listingIntake.state,
            city: listingIntake.city,
            street: listingIntake.street,
            zipcode: listingIntake.zipcode,
            amenities: JSON.parse(listingIntake.amenities).map((amenity: any) => {
                return { amenityId: Number(amenity) };
            }),
            currencyCode: listingIntake.currencyCode,
            price: listingIntake.price,
            priceForExtraPerson: listingIntake.priceForExtraPerson,
            guestsIncluded: listingIntake.guestsIncluded,
            cleaningFee: listingIntake.cleaningFee,
            airbnbPetFeeAmount: listingIntake.airbnbPetFeeAmount,
            houseRules: listingIntake.houseRules,
            checkOutTime: listingIntake.checkOutTime,
            checkInTimeStart: listingIntake.checkInTimeStart,
            checkInTimeEnd: listingIntake.checkInTimeEnd,
            squareMeters: listingIntake.squareMeters,
            language: listingIntake.language,
            instantBookable: listingIntake.instantBookable,
            wifiUsername: listingIntake.wifiUsername,
            wifiPassword: listingIntake.wifiPassword,
            airBnbCancellationPolicyId: listingIntake.airBnbCancellationPolicyId,
            bookingCancellationPolicyId: listingIntake.bookingCancellationPolicyId,
            marriottBnbCancellationPolicyId: listingIntake.marriottBnbCancellationPolicyId,
            vrboCancellationPolicyId: listingIntake.vrboCancellationPolicyId,
            cancellationPolicyId: listingIntake.cancellationPolicyId,
            minNights: listingIntake.minNights,
            maxNights: listingIntake.maxNights,
            airbnbName: listingIntake.airbnbName,
            airbnbSummary: listingIntake.airbnbSummary,
            airbnbSpace: listingIntake.airbnbSpace,
            airbnbAccess: listingIntake.airbnbAccess,
            airbnbInteraction: listingIntake.airbnbInteraction,
            airbnbNeighborhoodOverview: listingIntake.airbnbNeighborhoodOverview,
            airbnbTransit: listingIntake.airbnbTransit,
            airbnbNotes: listingIntake.airbnbNotes,
            homeawayPropertyName: listingIntake.homeawayPropertyName,
            homeawayPropertyHeadline: listingIntake.homeawayPropertyHeadline,
            homeawayPropertyDescription: listingIntake.homeawayPropertyDescription,
            bookingcomPropertyName: listingIntake.bookingcomPropertyName,
            bookingcomPropertyDescription: listingIntake.bookingcomPropertyDescription,
            marriottListingName: listingIntake.marriottListingName,
            contactName: listingIntake.contactName,
            contactPhone1: listingIntake.contactPhone1,
            contactLanguage: listingIntake.contactLanguage,

            listingBedTypes: listingIntake.listingBedTypes.map(bedType => ({
                bedTypeId: bedType.bedTypeId,
                quantity: bedType.quantity,
                bedroomNumber: bedType.bedroomNumber,
            })),

            propertyLicenseNumber: listingIntake.propertyLicenseNumber,
            propertyLicenseType: listingIntake.propertyLicenseType,
            propertyLicenseIssueDate: listingIntake.propertyLicenseIssueDate,
            propertyLicenseExpirationDate: listingIntake.propertyLicenseExpirationDate,
        };

        logger.info("Hostaway payload:", JSON.stringify(hostawayPayload));

        //simulate taking time of 10s
        await new Promise(resolve => setTimeout(resolve, 10000));

        // const response = await this.hostawayClient.createListing(hostawayPayload);
        // if (!response) {
        //     throw new CustomErrorHandler(500, "Failed to publish listing intake to Hostaway");
        // }
        // // Update the listingIntake status to published
        // listingIntake.status = "published";
        // listingIntake.listingId = response.id; // Assuming response contains the Hostaway listing ID
        // listingIntake.updatedBy = userId;
        // await this.listingIntakeRepo.save(listingIntake);

        return { message: "Listing intake published to Hostaway successfully", listingIntake };
    }

}