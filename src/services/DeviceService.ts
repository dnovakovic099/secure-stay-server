import { Request } from "express";
import { SeamConnect } from "../client/SeamConnect";

export class DeviceService {

    private seamConnect = new SeamConnect();
    async getDevicesInfo() {
        return this.seamConnect.getDevicesData();
    }

    async getConnectedList() {
        return this.seamConnect.getDevicesConnectedList()
    }

    //get device detail
    async getDevicesDetaildata(request: Request) {
        const deviec_id = String(request.body.device_id);
        return this.seamConnect.getDevicesDetails(deviec_id)
    }

    //lock Device
    async lockDevice(request: Request) {
        const deviec_id = String(request.body.device_id);
        return this.seamConnect.lockDeviceData(deviec_id)
    }

    //unloack Device
    async unlockDevice(request: Request) {
        const deviec_id = String(request.body.device_id);
        return this.seamConnect.unlockDeviceData(deviec_id)
    }

    //get clientsessiontoken
    async getClientSessioToken(){
        return this.seamConnect.getClientSessionToken()
    }
}
