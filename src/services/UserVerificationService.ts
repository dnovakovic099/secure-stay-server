import {Request, Response} from "express";
import {appDatabase} from "../utils/database.util";
import {ReservationEntity} from "../entity/Reservation";
import {UserVerificationEntity} from "../entity/UserVerification";


export class UserVerificationService {
    private reservationRepository = appDatabase
        .getRepository(ReservationEntity);
    private userVerificationRepository = appDatabase
        .getRepository(UserVerificationEntity);

    async saveUserVerification(request: Request, fileLocation: string) {
        let userVerification: UserVerificationEntity = request.body;
        userVerification.photo = fileLocation;
        userVerification.approved = 1;

        const reservationLink = request.params.reservationLink;
        if (!reservationLink) {
            return 'Bad Request - Missing required data';
        }


        await this.reservationRepository
            .findOne({where: {reservationLink}})
            .then(data => {
                const updatedReservation = data;
                if (updatedReservation.userVerification) {
                    return;
                }
                this.userVerificationRepository.save(userVerification).then(userVer =>{
                    updatedReservation.userVerification = userVer
                    this.reservationRepository.save(updatedReservation);
                });
            })
        return "Successful saved user verification";
    }
}


