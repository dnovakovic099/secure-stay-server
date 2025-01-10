import { UpsellOrderController } from "../controllers/UpsellOrderController";


export const UpsellOrdersRoutes = () => {

    const upsellOrderController = new UpsellOrderController();

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
    ];

};