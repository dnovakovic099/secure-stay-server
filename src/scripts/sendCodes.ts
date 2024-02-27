import dotenv from 'dotenv';
dotenv.config();
import { DeviceService } from "../services/DeviceService";
import { ListingService } from "../services/ListingService";
import { ReservationService } from "../services/ReservationService";

export async function sendCodes() {
    try {
        const reservationService = new ReservationService();
        const listingService = new ListingService();
        const deviceServices = new DeviceService();

        const pmclient = "Hostaway";  // This will be dynamic for different users

        const reservations = await reservationService[`get${pmclient}ReservationListStartingToday`]();

        for (const reservation of reservations) {
            const phone = reservation?.phone?.toString();
            const code = phone?.substr(-4);
            const guestName = reservation.guestName;

            const { device_id, device_type } = await listingService.getLockInfoAssociatedWithListing(reservation?.listingMapId);

            console.log(`Listing ${reservation.listingMapId} has deviceId:${device_id}`);

            if (device_id) {
                await deviceServices.sendPassCodes(device_id, device_type, guestName, code);
            }
            console.log('---------------------');
        }
    } catch (error) {
        console.log(`Error running the sendCode script:`, error?.message);
    }
}

sendCodes()

