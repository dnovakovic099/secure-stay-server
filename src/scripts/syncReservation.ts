import { format } from "date-fns";
import { getStartOfThreeMonthsAgo } from "../helpers/date";
import { ReservationInfoService } from "../services/ReservationInfoService";
import logger from "../utils/logger.utils";

export async function syncReservation() {
    // const date = getStartOfThreeMonthsAgo();
    const date=format(new Date(), "yyyy-MM-dd");
    logger.info("Syncing reservations...");
    const reservationInfoService = new ReservationInfoService();
    await reservationInfoService.syncReservations(date);
    logger.info("Reservation synchronization completed successfully.");
}