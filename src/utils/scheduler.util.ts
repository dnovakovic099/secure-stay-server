import { DeviceService } from "../services/DeviceService";
import { ListingService } from "../services/ListingService";
import { ReservationService } from "../services/ReservationService";

export function scheduleGetReservation() {
  const schedule = require("node-schedule");
  schedule.scheduleJob("*/5 * * * *", function () {
    console.log("Application is working: " + new Date());
  });

  async function scheduleSendCodes() {
    const reservationService = new ReservationService();
    const listingService = new ListingService();
    const deviceServices = new DeviceService();

    try {
      const reservations = await reservationService.getReservationList();

      for (let i = 0; i < reservations.length; i++) {
        //fetch the device_id of the reservation listing
        const device_id = await listingService.getDeviceIdByListingId(
          reservations[i].listingMapId
        );

        if (device_id) {
          let phone = reservations[i]?.phone;
          let phoneNumberString = phone?.toString();
          let code = phoneNumberString?.substr(-4);

          const response = await deviceServices.createCodesForSifelyDevice(
            device_id,
            reservations[i].guestName,
            code
          );
          if (response.status == 200) {
            console.log(
              `
                        Lock code sent successfully,
                        reservation:${reservations[i].id}
                        listing: ${reservations[i].listingMapId}
                        guestName: ${reservations[i].guestName}
                        code: ${code}
                `
            );
          }
        }
      }
    } catch (error) {
      console.log(error?.message);
    }
    console.log("Job ran successfully!");
  }
  schedule.scheduleJob("* * * * *", scheduleSendCodes);
}
