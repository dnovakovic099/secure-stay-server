import { Request, Response } from "express";
import { DeviceService } from "../services/DeviceService";

export class DevicesController {
  async getDevicesInfo(request: Request, response: Response) {
    const deviceService = new DeviceService();
    response.status(200).send(await deviceService.getDevicesInfo());
  }

  async getConnectedList(request: Request, response: Response) {
    const deviceService = new DeviceService();
    response.status(200).send(await deviceService.getConnectedList());
  }

  //get Device details
  async getDevicesDetaildata(request: Request, response: Response) {
    const deviceService = new DeviceService();
    response.send(await deviceService.getDevicesDetaildata(request));
  }

  //lock Device
  async lockDevice(request: Request, response: Response) {
    const deviceService = new DeviceService();
    response.send(await deviceService.lockDevice(request));
  }

  //unlock Device
  async unlockDevice(request: Request, response: Response) {
    const deviceService = new DeviceService();
    response.send(await deviceService.unlockDevice(request));
  }

  //getclientsessiontoken
  async getClientSessionToken(request: Request, response: Response) {
    const deviceServices = new DeviceService();
    response.send(await deviceServices.getClientSessionToken());
  }

  //get access token for sifely devices
  async getAccessToken(request: Request, response: Response) {
    const deviceService = new DeviceService();
    response.send(await deviceService.getAccessToken(request));
  }

  //get sifely locks
  async getSifelyLocks(request: Request, response: Response) {
    const deviceService = new DeviceService();
    response.send(await deviceService.getSifelyLocks(request));
  }

  //get sifely lock info
  async getSifelyLockInfo(request: Request, response: Response) {
    const deviceService = new DeviceService();
    response.send(await deviceService.getSifelyLockInfo(request));
  }

  async saveLockListingInfo(request: Request, response: Response) {
      const deviceService = new DeviceService();
    return response.send(await deviceService.saveLockListingInfo(request));
  }

  //get listings associated with the device
  async getDeviceListings(request: Request, response: Response) {
    const deviceService = new DeviceService();
    response.send(await deviceService.getDeviceListings(request));
  }
}
