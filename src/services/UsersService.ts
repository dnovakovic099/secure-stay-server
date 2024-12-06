import { Request,Response} from "express";
import { appDatabase } from "../utils/database.util";
import { UsersEntity } from "../entity/Users";
import { UsersInfoEntity } from "../entity/UserInfo";
import { EntityManager, Like } from "typeorm";
import { UserApiKeyEntity } from "../entity/UserApiKey";
import { generateAPIKey } from "../helpers/helpers";
import { HostAwayClient } from "../client/HostAwayClient";
import { ConnectedAccountService } from "./ConnectedAccountService";
import { MobileUsersEntity } from "../entity/MoblieUsers";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "../utils/supabase";


interface ApiKey {
    apiKey: String;
}
export class UsersService {

    private usersRepository = appDatabase.getRepository(UsersEntity);
    private userInfoRepository = appDatabase.getRepository(UsersInfoEntity);
    private userApiKeyRepository = appDatabase.getRepository(UserApiKeyEntity);
    private hostAwayClient = new HostAwayClient();
    private connectedAccountServices = new ConnectedAccountService();
    private mobileUser = appDatabase.getRepository(MobileUsersEntity)


    async createUser(request: Request, response: Response) {
        const userData =(request.body);
        // console.log("userData",userData);

        try {

            const checkExistingUser = await this.usersRepository.findOne({
                where: {
                    email: userData?.email,
                }
            });

            if (checkExistingUser) {
                return response.status(409).json({
                    message: 'Email has been already used!!!'
                });
            }

            const savedData = await this.usersRepository.save(userData);
            // console.log("savedData", savedData);

            return response.status(200).json({
                message: 'User created successfully',
                data: savedData,
            });
            
        } catch (error) {
            console.log("error",error);
            throw error;
        }
    }


    async checkUserForGoogleLogin(email: string, uid: string) {
        const isExist = await this.usersRepository.findOne({
            where: {
                email: email,
                uid: uid
            }
        });

        if (!isExist) {
            return false;
        } else {
            return true;
        }
    }

    async checkUserEmail(email: string) {
        const isExist = await this.usersRepository.findOne({
            where: {
                email: email
            }
        });

        if (!isExist) {
            return {
                success: false,
                message: 'Please provide valid user!!!'
            };
        }

        return {
            success: true,
            message: 'Valid user!!!'
        };
    }


    async googleLoginSingUp(userData: object) {

        const data = await this.usersRepository.save(userData);
        return data;
    }


    async createNewUser(request: Request) {

        try {
            const data: any = request.body;

            if (!data.fullName || !data.email || !data.userType) return {
                status: true,
                message: "Provide all required values!!!"
            };

            await this.userInfoRepository.save(data);

            return {
                status: true,
                message: "User created successfully!!!"
            };

        } catch (error) {
            throw new Error(error);
        }

    }

    async updateUser(request: Request) {

        const data: any = request.body;
        const userId: number = Number(data.userId);

        try {

            const user = await this.userInfoRepository.findOne({
                where: {
                    userId: userId,
                    isActive: true
                }
            });

            if (!user) {
                return {
                    status: true,
                    message: `User not found for update!!!`
                };
            }

            await this.userInfoRepository.update(userId, data);
            return {
                status: true,
                message: 'Data updated Successfully!!!'
            };

        } catch (error) {
            throw error;
        }
    }



    async getUserList(request: Request) {

        const page: any = request.query.page || 1;
        const limit: any = request.query.limit || 10;
        const fullName: any = request.query.fullName || '';
        const offset: any = (page - 1) * limit;

        try {

            if (!page || !limit) return {
                status: true,
                message: "Provide page and limit!!!"
            };

            const userInfo = await this.userInfoRepository.findAndCount({
                where: {
                    fullName: Like(`%${fullName}%`),
                    isActive: true
                },
                take: limit,
                skip: offset,
                order: {
                    userId: "DESC"
                }
            });

            const totalCount = await this.userInfoRepository.count({
                where: {
                    isActive: true
                }
            });

            return {
                status: true,
                data: [
                    userInfo[0],
                    totalCount
                ]

            };

        } catch (error) {
            throw new Error(error);
        }
    }

    async getSingleUser(request: Request) {

        const userId: any = (request.query.userId);

        if (!userId) return {
            status: true,
            message: "Provide user id!!!"
        };

        try {


            const user = await this.userInfoRepository.findOne({
                where: {
                    userId: userId,
                    isActive: true
                }
            });

            if (!user) return {
                status: true,
                message: "User not found!!!"
            };

            return {
                status: true,
                message: "Data found successfully!!!",
                data: user
            };

        } catch (error) {
            throw new Error(error);
        }
    }

    async deleteUser(request: Request) {

        const userId: any = request.query.userId;

        try {

            if (!userId) return {
                status: true,
                message: "Provide user!!!"
            };

            const user = await this.userInfoRepository.findOne({
                where: {
                    userId: userId,
                    isActive: true
                }
            });

            if (!user) {
                return {
                    status: true,
                    message: "No user found to delete!!!"
                };
            }

            await this.userInfoRepository.update(userId, { isActive: false, });
            return {
                status: true,
                message: 'Data deleted Successfully!!!'
            };

        } catch (error) {
            throw new Error(error);
        }
    }


    async updateUserStatus(request: Request) {

        const userId: any = request.query.userId;
        const status: any = request.query.status;

        try {

            if (!userId) {
                return {
                    status: true,
                    message: "Please provide user!!!"
                };
            }

            const user = await this.userInfoRepository.findOne({
                where: {
                    userId: userId,
                    isActive: true
                }
            });

            if (!user) return {
                status: true,
                message: "User not found!!!"
            };

            const data = await this.userInfoRepository.update(userId, { status: status == 1 ? 0 : 1 });

            if (data.affected == 1) return {
                status: true,
                message: "User updated successfully!!!"
            };

            return {
                status: false,
                message: "Couldn't update status!!!"
            };



        } catch (error) {
            throw new Error(error);

        }
    };

    async updateMultipleUserStatus(request: Request) {
        const { userIds, userStatus } = request.body;

        try {

            if (Array.isArray(userIds)) {
                await appDatabase.transaction(async (updateUserTransaction: EntityManager) => {
                    await Promise.all(userIds?.map(async (user) => {
                        await updateUserTransaction.update(UsersInfoEntity, user, { status: userStatus });
                    }));

                });

                return {
                    status: true,
                    message: "User status updated successfully!!!"
                };
            } else {

                return {
                    status: true,
                    message: 'Please provide ids in array!!!'
                };
            }


        } catch (error) {
            throw new Error(error);
        }
    }

    async deleteMultipleUser(request: Request) {

        const userIds: any = request.body;

        try {

            if (!Array.isArray(userIds)) {

                return {
                    status: true,
                    message: "Provide data in array!!!"
                };
            }

            await Promise.all(userIds?.map(async (id) => {
                await this.userInfoRepository.update(id, { isActive: false });
            }));

            return {
                status: true,
                message: "Data deleted successfully!!!"
            };

        } catch (error) {
            throw new Error(error);
        }
    }

    async getApiKey(userId: string): Promise<ApiKey> {
        try {
            const apiKey = await this.userApiKeyRepository.findOne({ where: { userId, isActive: true } });
            if (!apiKey) {
                //create a new api key and return it
                return await this.generateApiKey(userId);
            }
            return { apiKey: apiKey.apiKey };
        } catch (error) {
            throw new Error(error);
        }
    }

    async generateApiKey(userId: string): Promise<ApiKey> {
        try {
            const newApiKey = generateAPIKey();
            const apiKey = await this.userApiKeyRepository.save({ userId, apiKey: newApiKey });
            return { apiKey: apiKey.apiKey };
        } catch (error) {
            throw new Error(error);
        }
    }

    async getHostawayUsersList(userId: string) {

        const { clientId, clientSecret } = await this.connectedAccountServices.getPmAccountInfo(userId);
        const hostawayUsersList = await this.hostAwayClient.getUserList(clientId, clientSecret);
        const users = hostawayUsersList.map(({ email, firstName, id, lastName }) => ({
            hostawayId: id,
            email,
            firstName,
            lastName,
        }));
        return users;
    }

    async signUpUserInSupabase(email: string, firstName: string, lastName: string, password: string) {

        const user = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                firstName,
                lastName,
                userType: 'mobileUser',
            },
        });

        return user;

    }

    async createMobileUser(userInfo: {
        hostawayId: number;
        revenueSharing: number;
        firstName: string;
        lastName: string | null;
        email: string;
        password: string;
    }) {
        const { email, hostawayId, firstName, lastName, password, revenueSharing } = userInfo;


        const { data, error } = await this.signUpUserInSupabase(email, firstName, lastName, password);

        if (error) {
            console.log(error.message);

            return {
                status: false,
                message: error.message ? error.message : "Unable to create user!!!",
            };
        }

        if (data) {
            const userData = {
                hostawayId,
                uid: data && data.user && data.user.id ? data.user.id : '',
                firstName,
                lastName,
                email,
                revenueSharing
            };

            const user = await this.mobileUser.save(userData);

            if (user) {
                return {
                    status: true,
                    message: "User created successfully!!!",
                };
            }
        }

        return {
            status: false,
            message: "Unable to save data in server database!!!",
        };


    }

    async getMobileUsers(request: Request) {
        const page = Number(request.query.page) || 1;
        const limit = Number(request.query.limit) || 10;
        const skip = (page - 1) * limit;
        const email = typeof request.query.email === 'string' ? request.query.email : '';

        const users = await this.mobileUser.find({
            select: [
                'id',
                'uid',
                'hostawayId',
                'firstName',
                'lastName',
                'email',
            ],
            where: email ? { email } : undefined,
            order: { id: 'DESC' },
            skip: skip,
            take: limit,
        });

        return {
            status: false,
            message: "Data not found!!!",
            data: users
        };
    }

}


