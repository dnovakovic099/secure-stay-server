import { getStartOfThreeMonthsAgo } from "../helpers/date";
import { ReservationInfoService } from "../services/ReservationInfoService";
import logger from "../utils/logger.utils";

export async function syncReservation() {
    const date = getStartOfThreeMonthsAgo();
    logger.info("Syncing reservations...");
    const reservationInfoService = new ReservationInfoService();
    await reservationInfoService.syncReservations(date);
    logger.info("Reservation synchronization completed successfully.");
}

export async function syncCurrentlyStayingReservations() {
    logger.info("Syncing currently staying reservations...");
    const reservationInfoService = new ReservationInfoService();
    await reservationInfoService.syncCurrentlyStayingReservations();
    logger.info("Currently staying reservations synchronization completed successfully.");
}