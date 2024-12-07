import CustomErrorHandler from "../middleware/customError.middleware";
import { MobileUsersEntity } from "../entity/MoblieUsers";
import { appDatabase } from "../utils/database.util";
import bcrypt from "bcryptjs";
import { JwtServices } from "./JwtServices";

export class AuthService {
    private mobileUserRepo = appDatabase.getRepository(MobileUsersEntity);
    private jwtServices = new JwtServices();


    public async signin(email: string, password: string) {

        //check if user exists
        const user = await this.mobileUserRepo.findOne({ where: { email } });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            throw CustomErrorHandler.unAthorized('Unauthorized');
        }

        //generate jwt token
        const token = await this.jwtServices.sign({
            userId: user.id,
            email
        })

        return {
            accessToken: token,
            revenueSharing: user.revenueSharing
        };
    }
}
