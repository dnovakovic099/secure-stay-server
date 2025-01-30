import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { appDatabase } from "../utils/database.util";

export class ReservationInfoService {
  private reservationInfoRepository = appDatabase.getRepository(ReservationInfoEntity);

  async saveReservationInfo(reservation: Partial<ReservationInfoEntity>) {
    const isExist = await this.reservationInfoRepository.findOne({ where: { id: reservation.id } });
    if (isExist) {
      return await this.updateReservationInfo(reservation.id, reservation);
    }

    const newReservation = this.reservationInfoRepository.create(reservation);
    return await this.reservationInfoRepository.save(newReservation);
  }

  async updateReservationInfo(id: number, updateData: Partial<ReservationInfoEntity>) {
    return await this.reservationInfoRepository.update(id, updateData);
  }

}
