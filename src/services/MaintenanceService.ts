import { ListingDetail } from "../entity/ListingDetails";
import { Maintenance } from "../entity/Maintenance";
import CustomErrorHandler from "../middleware/customError.middleware";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { format } from "date-fns";

export class MaintenanceService {
    private maintenanceRepo = appDatabase.getRepository(Maintenance);
    private listingDetailRepo = appDatabase.getRepository(ListingDetail);

    async createMaintenance(body: Partial<Maintenance>, userId: string) {
        const maintenance = this.maintenanceRepo.create({
            ...body,
            createdBy: userId,
            updatedBy: userId
        });
        return await this.maintenanceRepo.save(maintenance);
    }

    async updateMaintenance(body: Partial<Maintenance>, userId: string) {
        const existing = await this.maintenanceRepo.findOneBy({ id: body.id });
        if (!existing) {
            throw CustomErrorHandler.notFound(`Maintenance with ID ${body.id} not found.`);
        }

        const updated = this.maintenanceRepo.merge(existing, {
            ...body,
            updatedBy: userId
        });

        return await this.maintenanceRepo.save(updated);
    }

    async deleteMaintenance(id: number, userId: string) {
        const maintenance = await this.maintenanceRepo.findOneBy({ id });
        if (!maintenance) {
            throw CustomErrorHandler.notFound(`Maintenance with ID ${id} not found.`);
        }

        maintenance.deletedBy = userId;
        maintenance.deletedAt = new Date();

        return await this.maintenanceRepo.save(maintenance);
    }


    async automateMaintenanceLogs() {
        // Fetch all available listingDetails
        const listingDetails = await this.listingDetailRepo.find();
        if (!listingDetails || listingDetails.length === 0) {
            logger.info("No listing details found to automate maintenance logs.");
            return;
        }
        // Iterate through each listing detail
        for (const detail of listingDetails) {
            const currentDate = format(new Date(), 'yyyy-MM-dd');
            this.getDateForNextMaintenance(detail);
            console.log(this.getDateForNextMaintenance(detail))
        }
    }

    async getDateForNextMaintenance(listingDetail: ListingDetail) {
        const currentDate = new Date();

        // Determine the next 30 days maintenance date based on schedule type
        // "weekly", "bi-weekly", "monthly", "quarterly", "annually", "check-out basis","as required"
        switch (listingDetail.scheduleType) {
            case 'weekly':
                // Calculate next maintenance date for weekly schedule
                const dayOfWeek = JSON.parse(listingDetail.dayOfWeek);
                const nextSchedule = this.getUpcomingDatesForWeek(dayOfWeek);
                if (nextSchedule.length > 0) {
                    console.log(`upcoming dates for weekly maintenance: ${nextSchedule.map(date => format(date, 'yyyy-MM-dd'))}`);
                }
                return nextSchedule;
                break;
            case 'bi-weekly':

                break;
            case 'monthly':

                break;
            case 'quarterly':
                break;
            case 'annually':
                break;
            case 'check-out basis':
                break;
            case 'as required':
                break;
            default:

        }
    }

    getUpcomingDatesForWeek(dayList: number[], fromDate = new Date()) {
        const today = (fromDate.getDay() + 6) % 7 + 1; // Convert JS 0–6 to 1–7
        const result: Date[] = [];

        for (const day of dayList.sort((a, b) => a - b)) {
            if (day >= today) {
                const diff = day - today;
                const nextDate = new Date(fromDate);
                nextDate.setDate(fromDate.getDate() + diff);
                result.push(nextDate);
            }
        }

        return result;
    }



}