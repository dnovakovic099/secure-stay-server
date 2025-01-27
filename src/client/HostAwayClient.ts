import axios, { AxiosResponse } from "axios";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
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

  public async getReservationInfo(
    limit?: number,
    offset?: number,
  ): Promise<{ offset: number, limit: number, result: ReservationInfoEntity[] }> {
    let url = `https://api.hostaway.com/v1/reservations?limit=${limit}&offset=${offset}`;

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

  public async updateExpense(
    requestBody: {
      listingMapId: string;
      expenseDate: string;
      concept: string;
      amount: number;
      categories: string;
    },
    credentials: {
      clientId: string;
      clientSecret: string;
    },
    expenseId: number
  ) {
    try {
      const { clientId, clientSecret } = credentials;
      const url = `https://api.hostaway.com/v1/expenses/${expenseId}`;
      const token = await this.getAccessToken(clientId, clientSecret);

      const response = await axios.put(url, requestBody, {
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
    listingId: number | "",
    dateType: string,
    startDate: string,
    endDate: string,
    limit: number,
    offset: number,
    channelId: number | ""
  ): Promise<Object[]> {

    let url = `https://api.hostaway.com/v1/reservations?${dateType}StartDate=${startDate}&${dateType}EndDate=${endDate}&limit=${limit}&offset=${offset}&sortOrder=arrivalDate`;

    if (dateType == "prorated") {
      url = `https://api.hostaway.com/v1/reservations?departureStartDate=${startDate}&arrivalEndDate=${endDate}&limit=${limit}&offset=${offset}&sortOrder=arrivalDate`;
    }

    if (listingId) {
      url += `&listingId=${listingId}`;
    }

    if (channelId) {
      url += `&channelId=${channelId}`;
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

  public async getUserList(clientId: string, clientSecret: string) {
    let url = `https://api.hostaway.com/v1/users`;

    try {
      const token = await this.getAccessToken(clientId, clientSecret);

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-control": "no-cache",
        },
      });

      return response.data.result;
    } catch (error) {
      console.log(error);
      return null;
    }
  }

  public async getListingByUserId(userId: number, clientId: string, clientSecret: string) {
    let url = `https://api.hostaway.com/v1/listings?userId=${userId}`;

    try {
      const token = await this.getAccessToken(clientId, clientSecret);

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-control": "no-cache",
        },
      });

      return response.data.result;
    } catch (error) {
      console.log(error);
      return null;
    }
  }

  public async getExpenses(clientId: string, clientSecret: string, limit: number = 500) {
    let expenses: any[] = [];
    let offset = 0;
    let hasMoreData = true;

    try {
      const token = await this.getAccessToken(clientId, clientSecret);

      while (hasMoreData) {
        const url = `https://api.hostaway.com/v1/expenses?limit=${limit}&offset=${offset}`;

        const response = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Cache-control": "no-cache",
          },
        });

        const fetchedExpenses = response.data.result;

        // Add fetched expenses to the array
        expenses = expenses.concat(fetchedExpenses);

        // Check if there is more data
        if (fetchedExpenses.length < limit) {
          hasMoreData = false; // No more data if the last page contains less than `limit`
        } else {
          offset += limit; // Update offset for the next page
        }
      }

      return expenses;
    } catch (error) {
      console.log(error);
      return null;
    }
  }
  
  public async deleteExpense(expenseId: number, clientId: string, clientSecret: string) {
    let url = `https://api.hostaway.com/v1/expenses/${expenseId}`;

    try {
      const token = await this.getAccessToken(clientId, clientSecret);

      const response = await axios.delete(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-control": "no-cache",
        },
      });

      return response.data.result;
    } catch (error) {
      console.log(error);
      return null;
    }
  }
  public async financeStandardField(reservationId: number, clientId: string, clientSecret: string) {
    let url = `https://api.hostaway.com/v1/financeStandardField/reservation/${reservationId}`;

    try {
      const token = await this.getAccessToken(clientId, clientSecret);

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-control": "no-cache",
        },
      });

      return response.data.result;
    } catch (error) {
      console.log(error);
      return null;
    }
  }


  public async fetchConversationMessages(conversationId: number, clientId: string, clientSecret: string) {
    let url = `https://api.hostaway.com/v1/conversations/${conversationId}/messages`;

    try {
      const token = await this.getAccessToken(this.clientId, this.clientSecret);      

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-control": "no-cache",
        },
      });

      return response.data.result;
    } catch (error) {
      console.log(error);
      return null;
    }
  }

  public async getReservation(reservationId: number, clientId: string, clientSecret: string) {
    let url = `https://api.hostaway.com/v1/reservations/${reservationId}`;

    try {
      const token = await this.getAccessToken(this.clientId, this.clientSecret);

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-control": "no-cache",
        },
      });

      return response.data.result;
    } catch (error) {
      console.log(error);
      return null;
    }
  }
}


