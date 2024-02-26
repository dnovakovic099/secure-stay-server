import { UserVerificationController } from "../controllers/UserVerificationController";
import { ReservationInfoController } from "../controllers/ReservationInfoController";
import { ReservationController } from "../controllers/ReservationController";
import { ItemController } from "../controllers/ItemController";
import { FaqController } from "../controllers/FaqController";
import { PaymentController } from "../controllers/PaymentController";
import { CheckInController } from "../controllers/CheckInController";
import { DevicesController } from "../controllers/DevicesController";
import { UsersController } from "../controllers/UsersController";
import { ListingController } from "../controllers/ListingController";
import { UpSellController } from "../controllers/UpSellController";
import { DeviceRoutes } from "./deviceRoutes";
import { ListingRoutes } from "./listingRoutes";
import { UserRoutes } from "./userRoutes";

export const AppRoutes = () => {
  const userVerificationController = new UserVerificationController();
  const reservationInfoController = new ReservationInfoController();
  const reservationController = new ReservationController();
  const itemController = new ItemController();
  const faqController = new FaqController();
  const payController = new PaymentController();
  const checkInController = new CheckInController();
  const devicesController = new DevicesController();
  const usersController = new UsersController();
  const listingController = new ListingController();
  const upSellController = new UpSellController()
  const deviceRoutes = DeviceRoutes();
  const listingRoutes = ListingRoutes();
  const userRoutes = UserRoutes()

  return [
    {
      path: "/user-verification/:reservationLink",
      method: "post",
      action: userVerificationController.verifyUser,
      file: true,
      rawJson: false
    },
    {
      path: "/reservation-info/webhook",
      method: "post",
      action: reservationInfoController.saveReservation,
      file: false,
      rawJson: false
    },
    {
      path: "/reservation/:reservationLink",
      method: "get",
      action: reservationController.getReservationListingInfo,
      file: false,
      rawJson: false
    },
    {
      path: "/reservation/:reservationLink/status",
      method: "get",
      action: reservationController.getStatusForLink,
      file: false,
      rawJson: false
    },
    {
      path: "/reservation/:reservationLink/faq",
      method: "get",
      action: faqController.getAllFaqByReservation,
      file: false,
      rawJson: false
    },
    {
      path: "/reservation/:reservationLink/items",
      method: "get",
      action: itemController.getAllItemsByReservation,
      file: false,
      rawJson: false
    },
    {
      path: "/pay/reservation/:reservationLink",
      method: "post",
      action: payController.payReservation,
      file: false,
      rawJson: false
    },
    {
      path: "/pay/reservation/:reservationLink/item/:itemId",
      method: "post",
      action: payController.payItem,
      file: false,
      rawJson: false
    },
    {
      path: "/pay/verify/webhook",
      method: "post",
      action: payController.verifyPayment,
      file: false,
      rawJson: true
    },
    {
      path: "/reservation/:reservationLink/checkIn/tips",
      method: "get",
      action: checkInController.getAllByReservationLink,
      file: false,
      rawJson: false
    },
    {
      path: "/reservation/:reservationLink/checkIn",
      method: "post",
      action: checkInController.checkIn,
      file: false,
      rawJson: false
    },
    {
      path: "/device/connectWebview",
      method: "get",
      action: devicesController.getDevicesInfo,
      file: false,
      rawJson: true,
    },
    {
      path: "/device/deviceList",
      method: "get",
      action: devicesController.getConnectedList,
      file: false,
      rawJson: true,
    },
    {
      path: "/device/deviceDetail",
      method: "post",
      action: devicesController.getDevicesDetaildata,
      file: false,
      rawJson: false,
    },
    {
      path: "/device/lock_door",
      method: "post",
      action: devicesController.lockDevice,
      file: false,
      rawJson: false,
    },
    {
      path: "/device/unlock_door",
      method: "post",
      action: devicesController.unlockDevice,
      file: false,
      rawJson: false,
    },
    {
      path: "/users/create",
      method: "post",
      action: usersController.createUser,
      file: false,
      rawJson: false
    },
    {
      path: '/upsell/create',
      method: 'post',
      action: upSellController.createUpSell,
      file: true,
      rawJson: false
    },
    {
      path: '/upsell/update',
      method: 'put',
      action: upSellController.updateUpSell,
      file: true,
      rawJson: false

    },
    {
      path: '/upsell/upsellList',
      method: 'get',
      action: upSellController.getUpSell,
      file: false,
      rawJson: false
    },
    {
      path: '/upsell/delete',
      method: 'delete',
      action: upSellController.deleteUpSell,
      file: false,
      rawJson: false
    },
    {
      path: '/upsell/listing',
      method: 'get',
      action: upSellController.getAssociatedUpSellListing,
      file: false,
      rawJson: false
    },
    {
      path: '/upsell/delete-multiple',
      method: 'post',
      action: upSellController.deleteMultipleUpSell,
      file: false,
      rawJson: false
    },
    {
      path: '/upsell/update-multiple-status',
      method: 'put',
      action: upSellController.updateMultipleSellStatus,
      file: false,
      rawJson: false
    },
    {
      path: '/upsell/:id',
      method: 'get',
      action: upSellController.getUpSellById,
      file: false,
      rawJson: false
    },
    ...deviceRoutes,
    ...listingRoutes,
    ...userRoutes
  ];
}