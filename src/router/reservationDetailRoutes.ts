import { Router } from "express";
import { ReservationDetailController } from "../controllers/ReservationDetailController";
import { photoUpload } from "../utils/photoUpload.util";
import verifySession from "../middleware/verifySession";

const reservationDetailController = new ReservationDetailController();
const router = Router();


router.post('/:reservationId',verifySession, photoUpload.array('photos'), reservationDetailController.createWithPhotos);
router.get('/:reservationId',verifySession, reservationDetailController.getReservationDetail);
router.put(
    '/:reservationId',
    verifySession,
    photoUpload.array('photos'),
    reservationDetailController.updateReservationDetail
);

export default router;