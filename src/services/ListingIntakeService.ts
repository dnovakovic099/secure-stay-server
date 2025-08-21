import { appDatabase } from "../utils/database.util";
import { ListingIntake } from "../entity/ListingIntake";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ILike, In } from "typeorm";
import { UsersEntity } from "../entity/Users";
import { ListingIntakeBedTypes } from "../entity/ListingIntakeBedTypes";

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
        return await this.listingIntakeRepo.findOne({ where: { id: id }, relations: ["listingBedTypes"] });
    }

    async getListingIntakeStatus(listingIntake: ListingIntake) {
        let hasMissingValue = false;
        Object.values(listingIntake).forEach(value => {
            if (value == null || value == "") {
                hasMissingValue = true;
            }
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

}