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
}