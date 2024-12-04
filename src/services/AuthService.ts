import { supabase } from "../utils/supabase";
import CustomErrorHandler from "../middleware/customError.middleware";
import { MobileUsersEntity } from "../entity/MoblieUsers";
import { appDatabase } from "../utils/database.util";

export class AuthService {
    private mobileUserRepo = appDatabase.getRepository(MobileUsersEntity);

    public async signin(email: string, password: string) {

        //check if user exists
        const user = await this.mobileUserRepo.findOne({ where: { email } });
        if (!user) {
            throw CustomErrorHandler.unAthorized('Unauthorized');
        }

        const { data, error }: any = await supabase.auth.signInWithPassword({
            email: email ? email : "",
            password: password ? password : "",
        });

        if (error) {
            throw CustomErrorHandler.unAthorized(error.message);
        }

        const userMetaData = data.session.user.user_metadata;
        userMetaData.revenueSharing = user.revenueSharing;
        
        if ('userType' in userMetaData) {
            if (userMetaData.userType !== 'mobileUser') {
                throw CustomErrorHandler.unAthorized('Invalid user');
            }
        }

        return data.session;
    }
}
