import axios, { AxiosResponse } from "axios";

export class HostAwayClient {
  private clientId: string = process.env.HOST_AWAY_CLIENT_ID;
  private clientSecret: string = process.env.HOST_AWAY_CLIENT_SECRET;
  private accessToken: string | null = null;

  private async getAuthToken(): Promise<AxiosResponse> {
    const url = "https://api.hostaway.com/v1/accessTokens";
    const data = {
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: "general",
    };

    return axios.post(url, new URLSearchParams(data).toString(), {
      headers: {
        "Cache-control": "no-cache",
        "Content-type": "application/x-www-form-urlencoded",
      },
    });
  }

  private async getAccessToken(clientId: string, clientSecret: string) {
    const url = "https://api.hostaway.com/v1/accessTokens";
    const data = {
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "general",
    };

    const response = await axios.post(url, new URLSearchParams(data).toString(), {
      headers: {
        "Cache-control": "no-cache",
        "Content-type": "application/x-www-form-urlencoded",
      },
    });

    return response.data?.access_token;
  }

  public async getReservationInfo(): Promise<void> {
    const url = "https://api.hostaway.com/v1/reservations";

    try {
      const authResponse = await this.getAuthToken();
      this.accessToken = authResponse.data?.access_token;

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Cache-control": "no-cache",
        },
      });

      console.log(response.data);
    } catch (error) {
      throw error;
    }
  }

  public async getListingInfo(listingId: number) {
    const url = "https://api.hostaway.com/v1/listings/" + listingId;

    try {
      const authResponse = await this.getAuthToken();
      this.accessToken = authResponse.data?.access_token;

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Cache-control": "no-cache",
        },
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  public async getListing(clientId: string, clientSecret: string) {
    try {
      const url = `https://api.hostaway.com/v1/listings`;
      const token = await this.getAccessToken(clientId, clientSecret);

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-control": "no-cache",
        },
      });
      return response.data.result;
    } catch (error) {
      throw error;
    }
  }

  public async getReservationList(currentDate) {
    const url = `https://api.hostaway.com/v1/reservations?arrivalStartDate=${currentDate}&arrivalEndDate=${currentDate}`;
    try {
      const authResponse = await this.getAuthToken();
      this.accessToken = authResponse.data?.access_token;
      const headerConfig = {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Cache-control": "no-cache",
        },
      };
      const response = await axios.get(url, headerConfig);
      return response.data.result;
    } catch (error) {
      throw error;
    }
  }

  public async createExpense(requestBody: {
    listingMapId: string;
    expenseDate: string;
    concept: string;
    amount: number;
    categories: string;
  }, credentials: {
    clientId: string;
    clientSecret: string;
  }) {
    try {
      const { clientId, clientSecret } = credentials;
      const url = "https://api.hostaway.com/v1/expenses";
      const token = await this.getAccessToken(clientId, clientSecret);

      const response = await axios.post(url, requestBody, {
        headers: {
          "Cache-control": "no-cache",
          Authorization: `Bearer ${token}`,
        },
      });
      console.log(response.data);
      return response.data?.result;
    } catch (error) {
      console.log(error?.response?.data);
      return null;
    }
  }

  public async getReservations(
    clientId: string,
    clientSecret: string,
    listingId: number,
    dateType: string,
    startDate: string,
    endDate: string,
    limit: number,
    offset: number
  ): Promise<Object[]> {
    
    let url = `https://api.hostaway.com/v1/reservations?listingId=${listingId}&${dateType}StartDate=${startDate}&${dateType}EndDate=${endDate}&limit=${limit}&offset=${offset}&sortOrder=${dateType}DateDesc`;
    if (String(listingId) == '') {
      const url = `https://api.hostaway.com/v1/reservations?${dateType}StartDate=${startDate}&${dateType}EndDate=${endDate}&limit=${limit}&offset=${offset}&sortOrder=${dateType}DateDesc`;
    }

    try {
      const token = await this.getAccessToken(clientId, clientSecret);

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-control": "no-cache",
        },
      });

      return response.data?.result;
    } catch (error) {
      console.log(error);
      return null;
    }
  }
}


