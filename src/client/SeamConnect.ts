import Seam from "seam";
import axios, { AxiosResponse } from "axios";


export class SeamConnect {

  //create Connect Webview url seam 
  public async createConnectWebView() {
    const apiKey: string = process.env.SEAM_API_KEY;
    const seam = new Seam({ apiKey: apiKey });

    const createdConnectWebview = await seam.connectWebviews.create({
      custom_redirect_url: "http://localhost:3000/locks",
      custom_redirect_failure_url: "http://localhost:3000/dashboard",
      provider_category: "stable",
      wait_for_device_creation: true,
    });

    return createdConnectWebview;
  }

  public async getClientSessionToken() {

    const apiKey: string = process.env.SEAM_API_KEY;
    const seam = new Seam({ apiKey: apiKey });

    const apiUrl = `https://connect.getseam.com/connected_accounts/list`;
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    };

      const result = await axios.post(apiUrl, {}, config);
      const connected_accounts = result.data.connected_accounts;

      const clientSession = await seam.clientSessions.getOrCreate({
        connected_account_ids: connected_accounts.map(
          (acc: any) => acc.connected_account_id
        ),
      });

    return clientSession;
  }

  public async createAccessCodes(device_id: string, name: string, code: number, startDate: string, endDate: string) {
    const apiKey: string = process.env.SEAM_API_KEY;
    const seam = new Seam({ apiKey: apiKey });

    const apiUrl = `https://connect.getseam.com/access_codes/create`;

    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    };

    const body = {
      device_id,
      name,
      code,
      starts_at: startDate,
      ends_at: endDate,
    }

    try {
      const result = await axios.post(apiUrl,body, config);
      return result;
    } catch (error) {
      throw error;
    }

  }

  public async getAccessCodes(device_id: string) {
    const apiKey: string = process.env.SEAM_API_KEY;
    const seam = new Seam({ apiKey: apiKey });
    const apiUrl = `https://connect.getseam.com/access_codes/list?device_id=${device_id}`;
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    };    

    try {
      const result = await axios.get(apiUrl, config);
      return result.data?.access_codes;
    } catch (error) {
      throw error;
    }

  }

}
