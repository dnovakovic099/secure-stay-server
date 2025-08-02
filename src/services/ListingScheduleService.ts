import { In } from "typeorm";
import { ListingSchedule } from "../entity/ListingSchedule";
import CustomErrorHandler from "../middleware/customError.middleware";
import { appDatabase } from "../utils/database.util";

export class ListingScheduleService {
    private listingScheduleRepo = appDatabase.getRepository(ListingSchedule);

    async createListingSchedule(body: Partial<ListingSchedule>, userId: string) {
        const schedule = await this.listingScheduleRepo.findOne({
            where: {
                workCategory: body.workCategory,
                listingId: body.listingId,
            }
        });

        if (schedule) {
            return CustomErrorHandler.alreadyExists("Listing schedule already exists for this work category and listing");
        }

        const newSchedule = this.listingScheduleRepo.create({
            ...body,
            dayOfWeek: body.dayOfWeek ? JSON.stringify(body.dayOfWeek) : null,
        });
        newSchedule.createdBy = userId;
        return await this.listingScheduleRepo.save(newSchedule);
    }

    async getListingSchedulesByListingId(listingId: number[]) {
        return await this.listingScheduleRepo.find({ where: { listingId: In(listingId) } });
    }

    async getListingScheduleById(id: number) {
        return await this.listingScheduleRepo.findOne({ where: { id } });
    }

    async updateListingSchedule(body: Partial<ListingSchedule>, userId: string) {
        const existingSchedule = await this.getListingScheduleById(body.id);
        if (!existingSchedule) {
            throw CustomErrorHandler.notFound("Listing schedule not found");
        }
        Object.assign(existingSchedule, body);
        existingSchedule.updatedBy = userId;
        existingSchedule.dayOfWeek = body.dayOfWeek ? JSON.stringify(body.dayOfWeek) : null;
        return await this.listingScheduleRepo.save(existingSchedule);
    }

    async deleteListingSchedule(id: number, userId: string) {
        const existingSchedule = await this.getListingScheduleById(id);
        if (!existingSchedule) {
            throw CustomErrorHandler.notFound("Listing schedule not found");
        }
        existingSchedule.deletedBy = userId;
        existingSchedule.deletedAt = new Date();
        return await this.listingScheduleRepo.save(existingSchedule);
    }

}
