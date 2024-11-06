import { ConnectedAccountInfo } from "../entity/ConnectedAccountInfo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { appDatabase } from "../utils/database.util";

export class ConnectedAccountService {
    private connectedAccountInfoRepo = appDatabase.getRepository(ConnectedAccountInfo);

    async savePmAccountInfo(clientId: string, clientSecret: string, userId: string) {
        const isExist = await this.connectedAccountInfoRepo.findOne({ where: { account: 'pm', userId } });
        if (isExist) {
            throw CustomErrorHandler.alreadyExists('Account already connected');
        }

        const accountInfo = new ConnectedAccountInfo();
        accountInfo.account = 'pm';
        accountInfo.clientId = clientId;
        accountInfo.clientSecret = clientSecret;
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
        const [isPmCredentialExist, isSeamCredentialExist, isSifelyCredentialExist, isStripeCredentialExist] =
            await Promise.all([
                this.connectedAccountInfoRepo.findOne({ where: { account: "pm", userId } }),
                this.connectedAccountInfoRepo.findOne({ where: { account: "seam", userId } }),
                this.connectedAccountInfoRepo.findOne({ where: { account: "sifely", userId } }),
                this.connectedAccountInfoRepo.findOne({ where: { account: "stripe", userId } })
            ]);

        return {
            pm: isPmCredentialExist ? true : false,
            seam: isSeamCredentialExist ? true : false,
            sifely: isSifelyCredentialExist ? true : false,
            stripe: isStripeCredentialExist ? true : false
        };
    }

    async getPmAccountInfo(userId: string) {
        const { clientId, clientSecret } = await this.connectedAccountInfoRepo.findOne({ where: { account: 'pm', userId } });
        return { clientId, clientSecret };
    }
}