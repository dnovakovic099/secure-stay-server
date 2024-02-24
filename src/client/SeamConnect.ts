import Seam from "seam";
import axios, { AxiosResponse } from "axios";

const apiKey: string = process.env.SEAM_API_KEY;
const seam = new Seam({ apiKey: apiKey });

export class SeamConnect {
  //create Connect Webview url seam call
  public async getDevicesData() {
    const createdConnectWebview = await seam.connectWebviews.create({
      custom_redirect_url: "http://localhost:3000/businessSettings/devices",
      custom_redirect_failure_url: "http://localhost:3000/dashboard",
      provider_category: "stable",
      wait_for_device_creation: true,
    });
    return createdConnectWebview;
  }

  //Get connected device List
  public async getDevicesConnectedList() {
    const connectedDevices = await seam.locks.list();
    return connectedDevices;
  }

  // get devices details
  public async getDevicesDetails(id: string) {
    const apiUrl = "https://connect.getseam.com/devices/get";
    let requestBody = {
      device_id: id,
    };
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    try {
      const response = await axios.post(apiUrl, requestBody, {
        headers: headers,
      });
      // console.log('API Response:', response.data);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // lock Device
  public async lockDeviceData(id: string) {
    const apiUrl = "https://connect.getseam.com/locks/lock_door";
    let requestBody = {
      device_id: id,
    };
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    try {
      const response = await axios.post(apiUrl, requestBody, {
        headers: headers,
      });
      console.log("API Response:", response.data);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // unlock Device
  public async unlockDeviceData(id: string) {
    const apiUrl = "https://connect.getseam.com/locks/unlock_door";
    let requestBody = {
      device_id: id,
    };
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    try {
      const response = await axios.post(apiUrl, requestBody, {
        headers: headers,
      });
      console.log("API Response:", response.data);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  public async getClientSessionToken() {
    const apiUrl = `https://connect.getseam.com/connected_accounts/list`;
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    };
    try {
      const result = await axios.post(apiUrl, {}, config);
      const connected_accounts = result.data.connected_accounts;
      const clientSession = await seam.clientSessions.getOrCreate({
        connected_account_ids: connected_accounts.map(
          (acc: any) => acc.connected_account_id
        ),
      });
      return clientSession;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  public async createAccessCodes(device_id:string, name:string, code:number) {
    const apiUrl = `https://connect.getseam.com/access_codes/create`;
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    };
    try {
      const result = await axios.post(apiUrl, { device_id, name, code }, config);
      return result
    } catch (error) {
      throw new Error(`Error creating code for ${name} of device ${device_id}`)
    }
  }

}
