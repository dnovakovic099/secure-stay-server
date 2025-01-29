import { Router } from "express";
import { ReservationDetailController } from "../controllers/ReservationDetailController";
import { photoUpload } from "../utils/photoUpload.util";

const reservationDetailController = new ReservationDetailController();
const router = Router();


router.post('/:reservationId', photoUpload.array('photos'), reservationDetailController.createWithPhotos);
router.get('/:reservationId', reservationDetailController.getReservationDetail);
router.put(
    '/:reservationId',
    photoUpload.array('photos'),
    reservationDetailController.updateReservationDetail
);

export default router;