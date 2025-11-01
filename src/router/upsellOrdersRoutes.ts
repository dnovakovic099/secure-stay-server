import { Router } from "express";
import { UpsellOrderController } from "../controllers/UpsellOrderController";
import verifySession from "../middleware/verifySession";

const router = Router();
const upsellOrderController = new UpsellOrderController();

router.route('/orders')
    .get(
        verifySession,
        upsellOrderController.getOrders
    )
    .post(
        verifySession,
        upsellOrderController.createOrder
    );

router.route('/orders/:id')
    .put(
        verifySession,
        upsellOrderController.updateOrder
    )
    .delete(
        verifySession,
        upsellOrderController.deleteOrder
    );

// router.route('/process-checkout-upsells')
//     .post(verifySession, upsellOrderController.processCheckoutDateUpsells);

export default router;