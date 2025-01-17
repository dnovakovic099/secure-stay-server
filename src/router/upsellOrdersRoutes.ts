import { UpsellOrderController } from "../controllers/UpsellOrderController";
import { ChargeAutomationWebhookController } from "../controllers/ChargeAutomationWebhookController";

export const UpsellOrdersRoutes = () => {
    const upsellOrderController = new UpsellOrderController();
    const chargeAutomationWebhookController = new ChargeAutomationWebhookController();

    return [
        {
            path: "/upsell/orders",
            method: "get",
            action: upsellOrderController.getOrders,
            file: false,
            rawJson: false
        },
        {
            path: "/upsell/orders",
            method: "post",
            action: upsellOrderController.createOrder,
            file: false,
            rawJson: false
        },
        {
            path: "/upsell/orders/:id",
            method: "put",
            action: upsellOrderController.updateOrder,
            file: false,
            rawJson: false
        },
        {
            path: "/upsell/orders/:id",
            method: "delete",
            action: upsellOrderController.deleteOrder,
            file: false,
            rawJson: false
        },
        {
            path: "/upsell/webhook",
            method: "post",
            action: chargeAutomationWebhookController.handleWebhook,
            file: false,
            rawJson: true
        }
    ];
};