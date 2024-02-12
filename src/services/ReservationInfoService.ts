import {Request, Response} from "express";
import {ReservationInfoEntity} from "../entity/ReservationInfo";
import {appDatabase} from "../utils/database.util";
import {ReservationEntity} from "../entity/Reservation";
import {v4 as uuidv4} from 'uuid';
import {MailClient} from "../client/MailClient";

export class ReservationInfoService {

    private reservationInfoRepository = appDatabase
        .getRepository(ReservationInfoEntity);
    private reservationRepository = appDatabase
        .getRepository(ReservationEntity);
    private mailClient = new MailClient();

    async saveReservationInfo(request: Request, response: Response) {
        console.log(request.body)
        const newReservation = new ReservationEntity();
        newReservation.reservationLink = uuidv4();
        newReservation.checkedIn = 0;
        newReservation.earlyCheckIn = 0;

        try {
             this.reservationInfoRepository.save(request.body).then(savedData => {
                newReservation.reservationInfo = savedData;
                this.reservationRepository.save(newReservation);
            });
             this.mailClient.sendEmail("viktorcvetanovic@gmail.com",
                "Boarding pass verification","mail.template.html",newReservation.reservationLink);
            return 'Reservation saved successfully.';
        } catch (error) {
            console.error('Error saving reservation:', error);
            return 'Internal Server Error';
        }
    }

}
