import { ConnectedAccountInfo } from "../entity/ConnectedAccountInfo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { appDatabase } from "../utils/database.util";

export class ConnectedAccountService {
    private connectedAccountInfoRepo = appDatabase.getRepository(ConnectedAccountInfo);

    async savePmAccountInfo(account: string, clientId: string, clientSecret: string) {
        const isExist = await this.connectedAccountInfoRepo.findOne({ where: { account } });
        if (isExist) {
            throw CustomErrorHandler.alreadyExists('Account already connected');
        }

        const accountInfo = new ConnectedAccountInfo();
        accountInfo.account = account.toLowerCase();
        accountInfo.clientId = clientId;
        accountInfo.clientSecret = clientSecret;
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
}