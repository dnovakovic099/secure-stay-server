import { DeepPartial, Like } from "typeorm";
import { UpSellEntity } from "../entity/UpSell";
import { appDatabase } from "../utils/database.util";
import { Request, Response } from "express";

export class UpSellServices {

    private upSellRepository = appDatabase.getRepository(UpSellEntity)

    async saveUpSellInfo(request: Request, response: Response) {
        try {
            const upSellInfo: DeepPartial<UpSellEntity> = request.body
            await this.upSellRepository.save(upSellInfo)
            response.status(200).send({ "message": "Data saved successfully!!!" })
        } catch (error) {
            console.log(error)
        }
    }

    async updateUpSellInfo(request: Request, response: Response) {
        try {
            const upSellInfo = request.body
            await this.upSellRepository.update(upSellInfo.upSellId, upSellInfo)
            response.status(200).send({
                "message": "Data updated successfully!!!"
            })

        } catch (error) {
            console.log(error);
        }
    }

    async getUpSellInfo(request: Request, response: Response) {
        try {
            const page: any = request.query.page || 1;
            const limit: any = request.query.limit || 10;
            const title = request.query.title !== undefined ? request.query.title : "";
            const offset: any = (page - 1) * limit;

            let upSellInfo = await this.upSellRepository.findAndCount({
                where: {
                    title: Like(`${title}%`),
                    status: 1
                },
                take: limit,
                skip: offset
            })
            response.status(200).send(upSellInfo);
        } catch (error) {
            console.log(error);

        }
    }


    async deleteUpSellInfo(request: Request, response: Response) {
        try {
            const upsell_id: any = request.query.upSellId
            let upSellToUpdate = await this.upSellRepository.find({
                where: {
                    upSellId: upsell_id
                }
            })
            upSellToUpdate[0].status = 0
            await this.upSellRepository.update(upsell_id, upSellToUpdate[0])
            response.status(202).send({
                "message": "Data deleted successfully!!!"
            })
        } catch (error) {
            console.log(error);
        }
    }


}