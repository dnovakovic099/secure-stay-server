import { appDatabase } from "../utils/database.util";
import { ReservationDetail, ReviewMediationStatus, DoorCodeStatus } from "../entity/ReservationDetail";
import { ReservationCleanerPhoto } from "../entity/ReservationCleanerPhoto";

interface CreateReservationDetailDTO {
    reservationId: string;
    additionalNotes?: string;
    specialRequest?: string;
    reviewMediationStatus?: ReviewMediationStatus;
    doorCode?: DoorCodeStatus;
    photos?: Express.Multer.File[];
}

interface UpdateReservationDetailDTO {
    photoIdsToRemove?: string[];
    photos?: Express.Multer.File[];
    additionalNotes?: string;
    specialRequest?: string;
    doorCode?: DoorCodeStatus;
    reviewMediationStatus?: ReviewMediationStatus;
}

export class ReservationDetailService {

    async createReservationDetailWithPhotos(data: CreateReservationDetailDTO) {
        const queryRunner = appDatabase.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // Create reservation detail
            const reservationDetail = new ReservationDetail();
            reservationDetail.reservationId = data.reservationId;
            reservationDetail.additionalNotes = data.additionalNotes || '';
            reservationDetail.specialRequest = data.specialRequest || '';
            reservationDetail.doorCode = data.doorCode || DoorCodeStatus.UNSET;
            reservationDetail.reviewMediationStatus = data.reviewMediationStatus || ReviewMediationStatus.UNSET;

            // Save to ReservationDetail table
            const savedDetail = await queryRunner.manager.save(ReservationDetail, reservationDetail);

            // Handle photos if they exist
            const savedPhotos = [];
            if (data.photos && data.photos.length > 0) {
                for (const file of data.photos) {
                    const photo = new ReservationCleanerPhoto();
                    photo.photoName = file.filename;
                    photo.reservation = savedDetail;
                    
                    // Save to ReservationCleanerPhoto table
                    const savedPhoto = await queryRunner.manager.save(ReservationCleanerPhoto, photo);
                    savedPhotos.push(savedPhoto);
                }
            }

            await queryRunner.commitTransaction();

            return {
                reservationDetail: savedDetail,
                photos: savedPhotos
            };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    async getReservationDetail(reservationId: string) {
        // Fetch reservation detail with associated cleaner photos
        const reservationDetail = await appDatabase
            .getRepository(ReservationDetail)
            .findOne({
                where: { reservationId },
                relations: ['cleanerPhotos']
            });

        return reservationDetail;
    }

    async updateReservationDetail(reservationId: string, data: UpdateReservationDetailDTO) {
        const queryRunner = appDatabase.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const reservationDetail = await queryRunner.manager
                .findOne(ReservationDetail, {
                    where: { reservationId },
                });

            if (!reservationDetail) {
                throw new Error('Reservation detail not found');
            }

            if (data.additionalNotes) {
                reservationDetail.additionalNotes = data.additionalNotes;
            }
            if (data.specialRequest) {
                reservationDetail.specialRequest = data.specialRequest;
            }
            if (data.doorCode) {
                reservationDetail.doorCode = data.doorCode;
            }
            if (data.reviewMediationStatus) {
                reservationDetail.reviewMediationStatus = data.reviewMediationStatus;
            }

            // Handle photo removals if any
            if (data.photoIdsToRemove && data.photoIdsToRemove.length > 0) {
                await queryRunner.manager
                    .delete(ReservationCleanerPhoto, data.photoIdsToRemove);
            }

            // Save the updated reservation detail
            const savedDetail = await queryRunner.manager.save(ReservationDetail, reservationDetail);

            // Handle new photos if any
            if (data.photos && data.photos.length > 0) {
                for (const file of data.photos) {
                    const photo = new ReservationCleanerPhoto();
                    photo.photoName = file.filename;
                    photo.reservation = savedDetail;
                    await queryRunner.manager.save(ReservationCleanerPhoto, photo);
                }
            }

            await queryRunner.commitTransaction();

            // Fetch and return updated reservation detail with photos
            return await queryRunner.manager.findOne(ReservationDetail, {
                where: { reservationId },
                relations: ['cleanerPhotos']
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }
    }
} 
