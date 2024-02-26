import { NextFunction, Request, Response } from "express";
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
    try {
       const deviceService = new DeviceService();
       const { deviceId } = request.body

       response.send(await deviceService.lockDevice(deviceId));

     } catch (error) {
       throw error;
     }
  }

  //unlock Device
  async unlockDevice(request: Request, response: Response) {
    try {
      const deviceService = new DeviceService();
      const { deviceId } = request.body;

      return response.send(await deviceService.unlockDevice(deviceId));

    } catch (error) {
      throw error;
    }
  }

  //getclientsessiontoken
  async getClientSessionToken(request: Request, response: Response) {
    try {
      const deviceServices = new DeviceService();
      return response.send(await deviceServices.getClientSessionToken());
    } catch (error) {
      throw error;
    }
  }

  //get access token for sifely devices
  async getAccessToken(request: Request, response: Response) {
    try {
      const deviceService = new DeviceService();
      const { username, password } = request.body;

      return response.send(await deviceService.getAccessToken(username, password));

    } catch (error) {
      throw error;
    }
  }


  async getSifelyLocks(request: Request, response: Response) {
    try {
      const deviceService = new DeviceService();
      const { accessToken, pageNo, pageSize } = request.body;

      return response.send(await deviceService.getSifelyLocks(accessToken, pageNo, pageSize));

    } catch (error) {
      throw error;
    }
  }

  async getSifelyLockInfo(request: Request, response: Response) {
    try {
      const deviceService = new DeviceService();
      const { access_token, lockId } = request.body;

      return response.send(await deviceService.getSifelyLockInfo(access_token, lockId));

    } catch (error) {
      throw error;
    }
  }

  async saveLockListingInfo(request: Request, response: Response) {
    try {
      const deviceService = new DeviceService();
      const { deviceId, listingId, deviceType } = request.body;

      return response.send(await deviceService.saveLockListingInfo(deviceId, listingId, deviceType));

    } catch (error) {
      throw error;
    }
  }

  async getDeviceListing(request: Request, response: Response) {
    try {
      const deviceService = new DeviceService();
      const { deviceId } = request.params;

      response.send(await deviceService.getDeviceListing(deviceId));

    } catch (error) {
      throw error;
    }
  }

}
