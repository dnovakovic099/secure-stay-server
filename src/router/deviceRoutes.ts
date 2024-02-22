import { DevicesController } from "../controllers/DevicesController";

export const DeviceRoutes = () => {
  const devicesController = new DevicesController();
  return [
    {
      path: "/device/getclientsessiontoken",
      method: "get",
      action: devicesController.getClientSessionToken,
      file: false,
      rawJson: false,
    },
    {
      path: "/device/sifely/getaccesstoken",
      method: "post",
      action: devicesController.getAccessToken,
      file: false,
      rawJson: false,
    },
    {
      path: "/device/sifely/locklist",
      method: "post",
      action: devicesController.getSifelyLocks,
      file: false,
      rawJson: false,
    },
    {
      path: "/device/sifely/lockinfo",
      method: "post",
      action: devicesController.getSifelyLockInfo,
      file: false,
      rawJson: false,
    },
    {
      path: "/device/getlistings/:device_id",
      method: "get",
      action: devicesController.getDeviceListings,
      file: false,
      rawJson: false,
    },
    {
      path: "/device/savelocklistinginfo",
      method: "post",
      action: devicesController.saveLockListingInfo,
      file: false,
      rawJson: false,
    },
  ];
};
