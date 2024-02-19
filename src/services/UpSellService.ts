import { Like } from "typeorm";
import { UpSellEntity } from "../entity/UpSell";
import { appDatabase } from "../utils/database.util";
import { Request, Response } from "express";
import { UpSellListing } from "../entity/UpSellListing";
import { Listing } from "../entity/Listing";

export class UpSellServices {

    private upSellRepository = appDatabase.getRepository(UpSellEntity)
    private upSellListings = appDatabase.getRepository(UpSellListing)
    private listingInfoRepository = appDatabase.getRepository(Listing)

    async saveUpSellInfo(request: Request, response: Response) {
        try {
            const { listingIds, ...upSellInfo } = request.body

            await appDatabase.transaction(async (transactionalEntityManager) => {

                await transactionalEntityManager.save(UpSellEntity, upSellInfo)
                //saving listing to associated upSell
                await Promise.all(listingIds.map(async (listingId: number) => {
                    const upSellListing = new UpSellListing();
                    upSellListing.listingId = listingId;
                    upSellListing.upSellId = upSellInfo.upSellId;
                    upSellListing.status = 1;
                    await transactionalEntityManager.save(upSellListing);
                }));
            })
            response.status(200).send({ "message": "Data saved successfully!!!" })
        } catch (error) {
            response.send(error)
        }
    }

    async updateUpSellInfo(request: Request, response: Response) {
        try {
            const { listingIds, ...upSellInfo } = request.body
            //check for existing upsell
            const data = await this.upSellRepository.find({
                where: {
                    status: 1,
                    upSellId: upSellInfo.upSellId
                }
            })
            if (data.length == 0) {
                response.send("No associated upsell found.")
            } else {

                await appDatabase.transaction(async (transactionalEntityManager) => {
                    // Update UpSellListing status to 0
                    await transactionalEntityManager.update(UpSellListing, { upSellId: upSellInfo.upSellId }, { status: 0 });

                    // Update UpSellEntity
                    await transactionalEntityManager.update(UpSellEntity, upSellInfo.upSellId, upSellInfo);

                    // Save new UpSellListing records
                    await Promise.all(listingIds.map(async (listingId: number) => {
                        const upSellListing = new UpSellListing();
                        upSellListing.listingId = listingId;
                        upSellListing.upSellId = upSellInfo.upSellId;
                        upSellListing.status = 1;
                        await transactionalEntityManager.save(upSellListing);
                    }));
                })

                response.status(200).send({
                    "message": "Data updated successfully!!!"
                })
            }


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

            //check either upsell is present in the table
            const data = await this.upSellRepository.find({
                where: {
                    status: 1,
                    upSellId: upsell_id
                }
            })

            if (data.length == 0) {
                response.send("No associated upsell found.")
            } else {

                await appDatabase.transaction(async (transactionalEntityManager) => {
                    let upSellToUpdate = await transactionalEntityManager.find(UpSellEntity, {
                        where: {
                            upSellId: upsell_id
                        }
                    })

                    await transactionalEntityManager.update(UpSellListing, { upSellId: upsell_id }, { status: 0 });

                    upSellToUpdate[0].status = 0
                    await transactionalEntityManager.update(UpSellEntity, upsell_id, upSellToUpdate[0])

                })

                response.status(202).send({
                    "message": "Data deleted successfully!!!"
                })
            }

        } catch (error) {
            console.log(error);
        }
    }

    async getUpSellAssociatedListing(request: Request, response: Response) {
        try {

            const upSellId: any = request.query.upSellId
            //check for existing upsell
            const data = await this.upSellRepository.find({
                where: {
                    status: 1,
                    upSellId: upSellId
                }
            })

            if (data.length == 0) {
                response.send("No associated upsell found.")
            } else {

                let upSellListing: any[] = []
                let listingData = await this.upSellListings.find({
                    where: {
                        upSellId: upSellId,
                        status: 1
                    },
                })

                await Promise.all(listingData.map(async (data: any) => {
                    const listingsInfo: any = await this.listingInfoRepository.find({
                        where: { listingId: data.listingId }
                    });
                    upSellListing.push(listingsInfo)
                }))

                response.status(200).send(upSellListing);
            }


        } catch (error) {
            console.log(error);
        }
    }


}