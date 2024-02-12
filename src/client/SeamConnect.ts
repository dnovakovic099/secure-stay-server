import Seam from 'seam';
import axios, { AxiosResponse } from 'axios';

const apiKey: string = process.env.SEAM_API_KEY;
const seam = new Seam({ apiKey: apiKey })

export class SeamConnect {

    //create Connect Webview url seam call
    public async getDevicesData() {
        const createdConnectWebview = await seam.connectWebviews.create({
            custom_redirect_url: "http://localhost:3000/businessSettings",
            custom_redirect_failure_url: "http://localhost:3000/dashboard",
            provider_category: "stable",
            wait_for_device_creation: true,
        })
        return createdConnectWebview
    }

    //Get connected device List
    public async getDevicesConnectedList() {
        const connectedDevices = await seam.locks.list()
        return connectedDevices
    }

    // get devices details
    public async getDevicesDetails(id: string) {
        const apiUrl = 'https://connect.getseam.com/devices/get';
        let requestBody = {
            "device_id": id,
        };
        const headers = {
            'Accept': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        };
        try {
            const response = await axios.post(apiUrl, requestBody, { headers: headers })
            // console.log('API Response:', response.data);
            return response.data;
        } catch (error) {
            throw error;
        }
    }

    // lock Device
    public async lockDeviceData(id: string) {
        const apiUrl = 'https://connect.getseam.com/locks/lock_door';
        let requestBody = {
            "device_id": id,
        };
        const headers = {
            'Accept': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        };
        try {
            const response = await axios.post(apiUrl, requestBody, { headers: headers })
            console.log('API Response:', response.data);
            return response.data;
        } catch (error) {
            throw error;
        }
    }

    // unlock Device
    public async unlockDeviceData(id: string) {
        const apiUrl = 'https://connect.getseam.com/locks/unlock_door';
        let requestBody = {
            "device_id": id,
        };
        const headers = {
            'Accept': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        };
        try {
            const response = await axios.post(apiUrl, requestBody, { headers: headers })
            console.log('API Response:', response.data);
            return response.data;
        } catch (error) {
            throw error;
        }
    }
}

