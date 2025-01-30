import { UserVerificationController } from "../controllers/UserVerificationController";
import { ReservationInfoController } from "../controllers/ReservationInfoController";
import { ReservationController } from "../controllers/ReservationController";
import { ItemController } from "../controllers/ItemController";
import { FaqController } from "../controllers/FaqController";
import { PaymentController } from "../controllers/PaymentController";
import { CheckInController } from "../controllers/CheckInController";
import { UsersController } from "../controllers/UsersController";
import { UpSellController } from "../controllers/UpSellController";
import { ChargeAutomationWebhookController } from '../controllers/ChargeAutomationWebhookController';
// import { ListingRoutes } from "./listingRoutes";
import { UserRoutes } from "./userRoutes";
import { GuideBookRoutes } from "./guideBookRoutes";
import { AutomatedMessageRoutes } from "./AutomatedMessageRoutes";
import { PmRoutes } from "./pmRoutes";


export const AppRoutes = () => {
  const userVerificationController = new UserVerificationController();
  const reservationInfoController = new ReservationInfoController();
  const reservationController = new ReservationController();
  const itemController = new ItemController();
  const faqController = new FaqController();
  const payController = new PaymentController();
  const checkInController = new CheckInController();
  const usersController = new UsersController();
  const upSellController = new UpSellController();
  const chargeAutomationWebhookController = new ChargeAutomationWebhookController();
  const userRoutes = UserRoutes();
  const guideBookRoutes = GuideBookRoutes();
  const automatedMessageRoutes = AutomatedMessageRoutes();
  const pmRoutes = PmRoutes()

  return [
    {
      path: "/user-verification/:reservationLink",
      method: "post",
      action: userVerificationController.verifyUser,
      file: true,
      rawJson: false,
    },
    {
      path: "/reservations",
      method: "get",
      action: reservationController.getAllReservations,
      file: false,
      rawJson: false,
    },
    {
      path: "/reservations/export",
      method: "get",
      action: reservationController.exportReservationToExcel,
      file: false,
      rawJson: false,
    },
    {
      path: "/reservation-info/webhook",
      method: "post",
      action: reservationInfoController.saveReservation,
      file: false,
      rawJson: false,
    },
    {
      path: "/reservation/:reservationLink",
      method: "get",
      action: reservationController.getReservationListingInfo,
      file: false,
      rawJson: false,
    },
    {
      path: "/reservation/:reservationLink/status",
      method: "get",
      action: reservationController.getStatusForLink,
      file: false,
      rawJson: false,
    },
    {
      path: "/reservation/:reservationLink/faq",
      method: "get",
      action: faqController.getAllFaqByReservation,
      file: false,
      rawJson: false,
    },
    {
      path: "/reservation/:reservationLink/items",
      method: "get",
      action: itemController.getAllItemsByReservation,
      file: false,
      rawJson: false,
    },
    {
      path: "/pay/reservation/:reservationLink",
      method: "post",
      action: payController.payReservation,
      file: false,
      rawJson: false,
    },
    {
      path: "/pay/reservation/:reservationLink/item/:itemId",
      method: "post",
      action: payController.payItem,
      file: false,
      rawJson: false,
    },
    {
      path: "/pay/verify/webhook",
      method: "post",
      action: payController.verifyPayment,
      file: false,
      rawJson: true,
    },
    {
      path: "/reservation/:reservationLink/checkIn/tips",
      method: "get",
      action: checkInController.getAllByReservationLink,
      file: false,
      rawJson: false,
    },
    {
      path: "/reservation/:reservationLink/checkIn",
      method: "post",
      action: checkInController.checkIn,
      file: false,
      rawJson: false,
    },
    {
      path: "/users/create",
      method: "post",
      action: usersController.createUser,
      file: false,
      rawJson: false,
    },
    {
      path: "/upsell/create",
      method: "post",
      action: upSellController.createUpSell,
      file: true,
      rawJson: false,
    },
    {
      path: "/upsell/update",
      method: "put",
      action: upSellController.updateUpSell,
      file: true,
      rawJson: false,
    },
    {
      path: "/upsell/upsellList",
      method: "get",
      action: upSellController.getUpSell,
      file: false,
      rawJson: false,
    },
    {
      path: "/upsell/delete",
      method: "delete",
      action: upSellController.deleteUpSell,
      file: false,
      rawJson: false,
    },
    {
      path: "/upsell/listing",
      method: "get",
      action: upSellController.getAssociatedUpSellListing,
      file: false,
      rawJson: false,
    },
    {
      path: "/upsell/delete-multiple",
      method: "post",
      action: upSellController.deleteMultipleUpSell,
      file: false,
      rawJson: false,
    },
    {
      path: "/upsell/update-multiple-status",
      method: "put",
      action: upSellController.updateMultipleSellStatus,
      file: false,
      rawJson: false,
    },
    {
      path: "/upsell",
      method: "get",
      action: upSellController.getUpSellById,
      file: false,
      rawJson: false,
    },
    {
      path: "/upsell/webhook",
      method: "post",
      action: chargeAutomationWebhookController.handleWebhook,
      file: false,
      rawJson: true
    },
    ...userRoutes,
    ...guideBookRoutes,
    ...automatedMessageRoutes,
    ...pmRoutes
  ];
};
