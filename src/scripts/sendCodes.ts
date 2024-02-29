import dotenv from 'dotenv';
dotenv.config();
import { DeviceService } from "../services/DeviceService";
import { ReservationService } from "../services/ReservationService";
import mysql from 'mysql2/promise'

const connection = mysql.createConnection({
    host: process.env.DATABASE_URL,
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
});


export async function sendCodes() {
    try {
        const reservationService = new ReservationService();
        const deviceServices = new DeviceService();

        const pmclient = "Hostaway";  // This will be dynamic for different users

        const reservations = await reservationService[`get${pmclient}ReservationListStartingToday`]();

        for (const reservation of reservations) {
            const phone = reservation?.phone?.toString();
            const code = phone?.substr(-4);
            const guestName = reservation.guestName;

            const query =
                `
                SELECT
                    l.lock_id,
                    l.type AS device_type,
                    (CASE
                        WHEN
                            l.type = 'Sifely'
                        THEN
                            (SELECT
                                    accessToken
                                FROM
                                    sifely_lock_info
                                WHERE
                                    lockId = l.lock_id AND status = 1)
                        ELSE NULL
                    END) AS access_token
                FROM
                    listing_lock_info AS l
                    INNER JOIN listing_info as li on l.listing_id=li.listing_id
                WHERE
                    l.status = 1 AND li.id = ?
            `;
            
            const output = await (await connection).query(query, reservation.listingMapId);
            
            const lock_id = output[0] && output[0][0]?.lock_id;
            const device_type = output[0] && output[0][0]?.device_type;
            const access_token = output[0] && output[0][0]?.access_token;

            console.log(`Listing ${reservation.listingMapId} has deviceId:${lock_id}`);

            if (lock_id) {
                await deviceServices.sendPassCodes(lock_id, device_type, guestName, code,access_token);
            }
            console.log('---------------------');
        }
    } catch (error) {
        console.log(`Error running the sendCode script:`, error?.message);
    }
}

sendCodes()

