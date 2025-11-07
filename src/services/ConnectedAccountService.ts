import { Hostify } from "../client/Hostify";
import { ConnectedAccountInfo } from "../entity/ConnectedAccountInfo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { appDatabase } from "../utils/database.util";

export class ConnectedAccountService {
    private connectedAccountInfoRepo = appDatabase.getRepository(ConnectedAccountInfo);

    async savePmAccountInfo(clientId: string, clientSecret: string, apiKey: string, userId: string) {
        const existingAccount = await this.connectedAccountInfoRepo.findOne({ where: { account: 'pm', userId } });
        const isValidAPIKey = await this.validateHostifyAPIKey(apiKey);
        if (!isValidAPIKey) {
            throw CustomErrorHandler.forbidden('Invalid Hostify API Key');
        }
        if (existingAccount) {
            existingAccount.clientId = clientId;
            existingAccount.clientSecret = clientSecret;
            existingAccount.apiKey = apiKey;
            existingAccount.updated_at = new Date();
            return await this.connectedAccountInfoRepo.save(existingAccount);
        }

        const accountInfo = new ConnectedAccountInfo();
        accountInfo.account = 'pm';
        accountInfo.clientId = clientId;
        accountInfo.clientSecret = clientSecret;
        accountInfo.apiKey = apiKey;
        accountInfo.userId = userId;
        accountInfo.created_at = new Date();
        accountInfo.updated_at = new Date();

        return await this.connectedAccountInfoRepo.save(accountInfo);
    }

    async saveSeamAccountInfo(apiKey: string) {
        const isExist = await this.connectedAccountInfoRepo.findOne({ where: { account: 'seam' } });
        if (isExist) {
            throw CustomErrorHandler.alreadyExists('Account already connected');
        }

        const accountInfo = new ConnectedAccountInfo();
        accountInfo.account = 'seam';
        accountInfo.apiKey = apiKey;
        accountInfo.created_at = new Date();
        accountInfo.updated_at = new Date();

        return await this.connectedAccountInfoRepo.save(accountInfo);
    }

    async saveSifelyAccountInfo(clientId: string, clientSecret: string) {
        const isExist = await this.connectedAccountInfoRepo.findOne({ where: { account: 'sifely' } });
        if (isExist) {
            throw CustomErrorHandler.alreadyExists('Account already connected');
        }

        const accountInfo = new ConnectedAccountInfo();
        accountInfo.account = 'sifely';
        accountInfo.clientId = clientId;
        accountInfo.clientSecret = clientSecret;
        accountInfo.created_at = new Date();
        accountInfo.updated_at = new Date();

        return await this.connectedAccountInfoRepo.save(accountInfo);
    }

    async saveStripeAccountInfo(apiKey: string) {
        const isExist = await this.connectedAccountInfoRepo.findOne({ where: { account: 'stripe' } });
        if (isExist) {
            throw CustomErrorHandler.alreadyExists('Account already connected');
        }

        const accountInfo = new ConnectedAccountInfo();
        accountInfo.account = 'stripe';
        accountInfo.apiKey = apiKey;
        accountInfo.created_at = new Date();
        accountInfo.updated_at = new Date();

        return await this.connectedAccountInfoRepo.save(accountInfo);
    }

    async getConnectedAccountInfo(userId: string) {
        const [accountInfo] =
            await Promise.all([
                this.connectedAccountInfoRepo.findOne({ where: { account: "pm", userId } }),
            ]);

        return {
            pm: accountInfo && accountInfo.apiKey ? true : false,
        };
    }

    async getPmAccountInfo(userId: string) {
        const { clientId, clientSecret } = await this.connectedAccountInfoRepo.findOne({ where: { account: 'pm', userId } });
        return { clientId, clientSecret };
    }

    async deleteConnectedAccount(userId: string) {
        return await this.connectedAccountInfoRepo.delete({ userId });
    }

    async validateHostifyAPIKey(apiKey: string): Promise<boolean> {
        const hostifyAPIKey = process.env.HOSTIFY_API_KEY;
        return apiKey === hostifyAPIKey;
    }
}