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

        const pmclient = "Hostaway";  //this will be dynamic for different users

        try {
            const reservations = await reservationService[`get${pmclient}ReservationListStartingToday`]();

            for (let i = 0; i < reservations.length; i++) {

                const phone = reservations[i]?.phone;
                const phoneNumberString = phone?.toString();
                const code = phoneNumberString?.substr(-4);

                const { device_id, device_type } = await listingService.getLockInfoAssociatedWithListing(reservations[i]?.listingMapId);

                if (device_id) {

                    let isCodeExists = false;  //before creating code check if the code already exists for the guest
                    const accessCodes = await deviceServices[`getCodesFor${device_type}Device`](device_id, reservations[i].guestName, code);

                    if (accessCodes) {
                        for (let j = 0; j < accessCodes.length; j++) {
                            if (accessCodes[j]?.name == reservations[i].guestName && accessCodes[j]?.code == code) {
                                isCodeExists = true;
                            }
                        }
                    }

                    if (!isCodeExists) {

                      const response = await deviceServices[`createCodesFor${device_type}Device`](
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
            }
        } catch (error) {
            console.log(error?.message);
        }
        console.log("Job ran successfully!");
    }
    schedule.scheduleJob("* * * * *", scheduleSendCodes);
}
