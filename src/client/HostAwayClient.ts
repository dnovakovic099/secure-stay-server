import axios, { AxiosResponse } from 'axios';

export class HostAwayClient {
    private clientId: string = process.env.HOST_AWAY_CLIENT_ID;
    private clientSecret: string = process.env.HOST_AWAY_CLIENT_SECRET;
    private accessToken: string | null = null;

    private async getAuthToken(): Promise<AxiosResponse> {
        const url = 'https://api.hostaway.com/v1/accessTokens';
        const data = {
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            scope: 'general',
        };

        return axios.post(url, new URLSearchParams(data).toString(), {
            headers: {
                'Cache-control': 'no-cache',
                'Content-type': 'application/x-www-form-urlencoded',
            },
        });
    }

    public async getReservationInfo(): Promise<void> {
        const url = 'https://api.hostaway.com/v1/reservations';

        try {
            const authResponse = await this.getAuthToken();
            this.accessToken = authResponse.data?.access_token;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Cache-control': 'no-cache',
                },
            });

            console.log(response.data);
        } catch (error) {
            throw error;
        }
    }


    public async getListingInfo(listingId: number) {
        const url = 'https://api.hostaway.com/v1/listings/' + listingId;

        try {
            const authResponse = await this.getAuthToken();
            this.accessToken = authResponse.data?.access_token;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Cache-control': 'no-cache',
                },
            });
            return response.data;
        } catch (error) {
            throw error;
        }
    }

    public async getListing() {
        const url = `https://api.hostaway.com/v1/listings`;
        try {
            const authResponse = await this.getAuthToken();
            this.accessToken = authResponse.data?.access_token;

            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    "Cache-control": "no-cache",
                },
            });
            return response.data.result
        } catch (error) {
            throw error
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
            const response = await axios.get(url,headerConfig);
            return response.data.result;
        } catch (error) {
            throw error
        }
    }

}

