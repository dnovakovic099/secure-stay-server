import { Request } from "express";
import { PmSoftwareEntity } from "../entity/PmSoftware";
import { appDatabase } from "../utils/database.util";
import { UsersEntity } from "../entity/Users";
import { UsersPmSoftwareEntity } from "../entity/UsersPmSoftware";
import { DeepPartial } from "typeorm";


export class PmServices {


    private pmRepository = appDatabase.getRepository(PmSoftwareEntity);
    private userRepository = appDatabase.getRepository(UsersEntity);
    private pmUserSoftwareRepository = appDatabase.getRepository(UsersPmSoftwareEntity);

    async getPropertyManagementList() {
        try {
            const data = await this.pmRepository.findAndCount({
                where: {
                    isActive: true
                }
            });
            return {
                success: true,
                data: data
            };
        } catch (error) {
            throw new Error;
        }
    };

    //for mapping with existing software from database
    async getUserPmSoftwareList(request: Request) {

        const uid: any = request.query.uid;

        if (!uid) {
            return {
                success: false,
                message: "Provide user!!!"
            };
        }

        try {

            const isUser = await this.userRepository.find({
                where: {
                    uid: uid
                }
            });

            if (!isUser) return {
                success: false,
                message: "Please provide valid user!!!"
            };

            const userPmSoftwareInfo = await this.pmUserSoftwareRepository
                .createQueryBuilder("ps")
                .select([
                    "ps.id AS user_pm_id",
                    "ps.uid AS user_supa_id",
                    "ps.userId",
                    "u.firstName AS firstName",
                    "u.lastName AS lastName",
                    "u.email AS email",
                    "u.companyName AS companyName",
                    "u.numberofProperties AS numberofProperties",
                    "pl.id AS pm_id",
                    "pl.pmName AS pmName"
                ])
                .innerJoin("ps.userId", "u", "u.id = ps.userId")
                .innerJoin("ps.pmId", "pl", "pl.id = ps.pmId")
                .where("ps.uid = :uid", { uid: uid })
                .getRawMany();

            if (!userPmSoftwareInfo) return {
                success: false,
                message: 'User not found!!!'
            };

            return {
                success: true,
                data: userPmSoftwareInfo
            };


        } catch (error) {
            throw new Error;
        }
    }



    //for mapping with existing software from database
    async saveUsersPmSoftware(request: Request) {
        const { uid, pmId }: any = request.body;

        try {

            if (!uid || !pmId) return {
                success: false,
                message: "Please provide user and pm!!!"
            };

            const user = await this.userRepository.findOne({
                where: {
                    uid: uid
                }
            });

            if (!user) return {
                success: false,
                message: "User doesn't exist!!!"
            };

            const isPmExist = await this.pmUserSoftwareRepository.findOne({
                where: {
                    uid: uid
                }
            });

            console.log('exist', isPmExist);


            if (isPmExist) return {
                success: false,
                message: "User have already pm software!!!"
            };

            const formData: any = { uid, pmId, userId: user.id };

            const pmSoftware = await this.pmUserSoftwareRepository.save(formData);

            if (!pmSoftware) return {
                success: false,
                message: "Can't save data!!!"
            };

            const userPmSoftwareInfo = await this.pmUserSoftwareRepository
                .createQueryBuilder("ps")
                .select([
                    "ps.id AS user_pm_id",
                    "ps.uid AS user_supa_id",
                    "ps.userId",
                    "u.firstName AS firstName",
                    "u.lastName AS lastName",
                    "u.email AS email",
                    "u.companyName AS companyName",
                    "u.numberofProperties AS numberofProperties",
                    "pl.id AS pm_id",
                    "pl.pmName AS pmName"
                ])
                .leftJoin("ps.userId", "u", "u.id = ps.userId")
                .leftJoin("ps.pmId", "pl", "pl.id = ps.pmId")
                .where("ps.uid = :uid", { uid: uid })
                .getRawMany();


            return {
                success: true,
                message: "Data saved successfully!!!",
                data: userPmSoftwareInfo
            };

        } catch (error) {
            throw new Error;
        }
    }



    async createUserPmSoftware(request: Request) {

        const { uid, pmId, pmName }: any = request.body;

        console.log(request.body);

        try {

            console.log('uid', uid, 'pmid', pmId, 'pmName', pmName);


            if (!uid || !pmId || !pmName) return {
                success: false,
                message: "Please provide all values!!!"
            };

            const user = await this.userRepository.findOne({
                where: {
                    uid: uid
                }
            });

            console.log('Hello');

            if (!user) return {
                success: false,
                message: "User doesn't exist!!!"
            };

            const isPmExist = await this.pmUserSoftwareRepository.findOne({
                where: {
                    uid: uid
                }
            });


            if (isPmExist) return {
                success: false,
                message: "User have already pm software!!!"
            };

            const formData: DeepPartial<UsersPmSoftwareEntity> = { uid, pmId, pmName };

            const pmSoftware = await this.pmUserSoftwareRepository.save(formData);

            return {
                success: true,
                message: 'Date saved successfully!!!',
                data: pmSoftware
            };

        } catch (error) {
            throw new Error;
        }
    }

    async getUserPmList(request: Request) {

        const uid: any = request.query.uid;

        if (!uid) {
            return {
                success: false,
                message: "Provide user!!!"
            };
        }
        console.log(uid);

        try {

            const isUser = await this.userRepository.find({
                where: {
                    uid: uid
                }
            });

            if (!isUser) return {
                success: false,
                message: "Please provide valid user!!!"
            };

            const userPmSoftwareInfo = await this.pmUserSoftwareRepository.findOne({
                where: {
                    uid: uid
                }
            });

            if (!userPmSoftwareInfo) return {
                success: false,
                message: 'User not found!!!',
                data: []
            };

            return {
                success: true,
                data: userPmSoftwareInfo
            };

        } catch (error) {
            throw new Error;
        }
    }


}