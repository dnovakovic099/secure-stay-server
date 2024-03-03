import { NextFunction, Request, Response } from "express";
import { DeviceService } from "../services/DeviceService";
import { dataNotFound, dataSaved, dataUpdated, successDataFetch } from "../helpers/response";

export class DevicesController {
  
  async createConnectWebView(request: Request, response: Response, next: NextFunction) {
    try {
      const deviceService = new DeviceService();
      const connectWebView = await deviceService.createConnectWebView();

      return response.status(200).json(successDataFetch(connectWebView));
    } catch (error) {
      return next(error);
    }
  }

  //getclientsessiontoken for seam devices
  async getClientSessionToken(request: Request, response: Response, next: NextFunction) {
    try {
      const deviceServices = new DeviceService();
      const clientSessionToken = await deviceServices.getClientSessionToken();

      return response.status(200).json(successDataFetch(clientSessionToken));
    } catch (error) {
      return next(error);
    }
  }

  //get access token for sifely devices
  async getAccessToken(request: Request, response: Response, next: NextFunction) {
    try {
      const deviceService = new DeviceService();
      const { username, password } = request.body;
      const token = await deviceService.getAccessToken(username, password);

      return response.status(200).json(successDataFetch(token));
    } catch (error) {
      return next(error);
    }
  }

  async getSifelyLocks(request: Request, response: Response, next: NextFunction) {
    try {
      const deviceService = new DeviceService();
      const sifelyLocks = await deviceService.getSifelyLocks();

      return response.status(200).json(successDataFetch(sifelyLocks));
    } catch (error) {
      return next(error);
    }
  }

  async getSifelyLockInfo(request: Request, response: Response, next: NextFunction) {
    try {
      const deviceService = new DeviceService();
      const lockInfo = await deviceService.getSifelyLockInfo(Number(request.params.lockId));

      if (lockInfo == null) {
        return response.status(200).json(dataNotFound());
      }

      return response.status(200).json(successDataFetch(lockInfo));
    } catch (error) {
      return next(error);
    }
  }

  async saveLockListingInfo(request: Request, response: Response, next: NextFunction) {
    try {
      const deviceService = new DeviceService();
      const { deviceId, listingId, deviceType } = request.body;

      await deviceService.saveLockListingInfo(deviceId, listingId, deviceType)

      return response.status(201).json(dataSaved('Device listing info saved successfully'))
    } catch (error) {
      return next(error);
    }
  }

  async getDeviceListing(request: Request, response: Response, next: NextFunction) {
    try {
      const deviceService = new DeviceService();
      const deviceListing = await deviceService.getDeviceListing(request.params.lockId);

      if (deviceListing == null) {
        return response.status(200).json(dataNotFound('Lock is not associated with any listing'));
      }

      return response.status(200).json(successDataFetch(deviceListing));
    } catch (error) {
      return next(error);
    }
  }

  async getPassCodesOfSifelyDevice(request: Request, response: Response, next: NextFunction) {
    try {
      const deviceService = new DeviceService();

      const queryObject = request.query;
      const accessToken: string = queryObject.accessToken as string;
      const lockId: string = queryObject.lockId as string;

      const passCodes = await deviceService.getCodesForSifelyDevice(accessToken, Number(lockId));
      if (passCodes?.length == 0) {
        return response.status(200).json(dataNotFound('Passcode not found!!!'));
      }

      return response.status(200).json(successDataFetch(passCodes));
    } catch (error) {
      return next(error);
    }
  }

  async createPassCode(request: Request, response: Response, next: NextFunction) {
    try {
      const deviceService = new DeviceService();
      const { accessToken, lockId, codeName, codeValue, timingOption, startDate, endDate } = request.body;

      const startDateTimestamp = timingOption !== 2 ? new Date(startDate).valueOf() : startDate;
      const endDateTimestamp = timingOption !== 2 ? new Date(endDate).valueOf() : endDate;

      await deviceService.createCodesForSifelyDevice(accessToken, lockId, codeName, codeValue, timingOption, startDateTimestamp, endDateTimestamp);

      return response.status(201).json(dataSaved('Passcode created successfully!!!'));
    } catch (error) {
      return next(error);
    }
  }

  async deletePassCode(request: Request, response: Response, next: NextFunction) {
    try {
      const deviceService = new DeviceService();
      const { accessToken, lockId, keyboardPwdId } = request.body;

      await deviceService.deletePassCodes(accessToken, lockId, keyboardPwdId);

      return response.status(200).json(dataUpdated('Passcode deleted successfully!!!'));
    } catch (error) {
      return next(error);
    }
  }

}
