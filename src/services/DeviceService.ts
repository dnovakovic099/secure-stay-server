import { Request } from "express";
import { SeamConnect } from "../client/SeamConnect";
import { SifelyClient } from "../client/SifelyClient";

export class DeviceService {

    private seamConnect = new SeamConnect();
    private sifelyClient = new SifelyClient()
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
    async getClientSessionToken() {
        return this.seamConnect.getClientSessionToken()
    }

    //get access token for sifely devices
    async getAccessToken(request: Request) {
        const { username, password } = request.body
        return this.sifelyClient.getaccestoken(username, password)
    }

    //get sifely locks
    async getSifelyLocks(request: Request) {
        const { access_token, pageNo, pageSize } = request.body
        //date in milliseconds
        const date = new Date().valueOf()
        return this.sifelyClient.getLockList(access_token, pageNo, pageSize, date)
    }

    //get sifely lock info
    async getSifelyLockInfo(request: Request) {
        const { access_token, lockId } = request.body
        //date in milliseconds
        const date = new Date().valueOf()
        return this.sifelyClient.getLockInfo(access_token, lockId, date)
    }

}
