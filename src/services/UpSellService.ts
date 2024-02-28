import { EntityManager, In, Like } from "typeorm";
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

                if (Array.isArray(listingIds)) {
                    await Promise.all(listingIds.map(async (listingId: number) => {
                        const upSellListing = new UpSellListing();
                        upSellListing.listingId = listingId;
                        upSellListing.upSellId = upSellInfo.upSellId;
                        upSellListing.status = 1;
                        await transactionalEntityManager.save(upSellListing);
                    }));
                }
            })

            return {
                status: true,
                message: "Data saved successfully!!!"
            }
        } catch (error) {
            throw new Error(error)
        }
    }

    async updateUpSellInfo(request: Request, response: Response) {
        try {
            const { listingIds, ...upSellInfo } = request.body

            //check for existing upsell
            const data = await this.upSellRepository.findOne({
                where: {
                    upSellId: upSellInfo.upSellId,
                    isActive: true
                }
            })

            if (!data) {
                return {
                    status: true,
                    message: "No associated upsell found!!!"
                }
            } else {

                await appDatabase.transaction(async (transactionalEntityManager) => {

                    // Update UpSellEntity
                    await transactionalEntityManager.update(UpSellEntity, upSellInfo.upSellId, upSellInfo);

                    // check either listing are present in the api request
                    if (Array.isArray(listingIds)) {
                        // Update UpSellListing status to 0
                        await transactionalEntityManager.update(UpSellListing, { upSellId: upSellInfo.upSellId }, { status: 0 });
                        // Save new UpSellListing records
                        await Promise.all(listingIds?.map(async (listingId: number) => {
                            const upSellListing = new UpSellListing();
                            upSellListing.listingId = listingId;
                            upSellListing.upSellId = upSellInfo.upSellId;
                            upSellListing.status = 1;
                            await transactionalEntityManager.save(upSellListing);
                        }));
                    }
                })

                return {
                    status: true,
                    message: "Data updated successfully!!!"
                }
            }
        } catch (error) {
            throw new Error(error)
        }
    }

    async updateMultipleSellStatus(request: Request, response: Response) {
        const { upSellId, status } = request.body

        //check for multiple upsell ids
        if (Array.isArray(upSellId)) {
            const invalidUpSellIds: any[] = [];
            await appDatabase.transaction(async (transactionalEntityManager: EntityManager) => {
                await Promise.all(upSellId.map(async (data: any) => {

                    //check for active upsells
                    const upSell = await transactionalEntityManager.findOne(UpSellEntity, {
                        where: {
                            upSellId: data,
                            isActive: true
                        }
                    });
                    if (!upSell) {
                        invalidUpSellIds.push(data);
                    } else {

                        // Update records in UpSellListing table
                        await transactionalEntityManager.update(
                            UpSellEntity,
                            { upSellId: data },
                            { status: status }
                        );
                    }
                }));
            });

            if (invalidUpSellIds.length > 0) {
                //error message for invalid upsell
                return {
                    status: false,
                    message: "Please provide valid upsells id",
                    invalidIds: invalidUpSellIds
                };
            } else {
                return {
                    status: true,
                    message: "Data updated successfully!!!"
                };
            }
        } else {
            return {
                status: true,
                message: "Please provide upsell in array!!!"
            };
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
                    isActive: true
                },
                take: limit,
                skip: offset,
                order: {
                    upSellId: "DESC"
                }
            })
            const totalCount = await this.upSellRepository.count({
                where: {
                    isActive: true
                }
            })

            return {
                status: true,
                data: upSellInfo[0],
                length: totalCount
            }
        } catch (error) {
            throw new Error(error)

        }
    }

    async getUpSellById(request: Request, response: Response) {
        try {
            const upSellId: any = request.query.upSellId
            let upSellInfo = await this.upSellRepository.findOne({
                where: {
                    upSellId: upSellId,
                    isActive: true
                },
            })
            if (upSellInfo) {
                return {
                    status: true,
                    data: upSellInfo
                }
            } else {
                return {
                    status: true,
                    message: "Provide valid upsell!!!"
                }
            }

        } catch (error) {
            throw new Error(error)
        }
    }

    async deleteUpSellInfo(request: Request, response: Response) {
        try {
            const upSellId: any = request.query.upSellId

            // check either upsell is present in the table
            const data = await this.upSellRepository.findOne({
                where: {
                    upSellId: upSellId,
                    isActive: true
                }
            })
            if (!data) {
                return {
                    status: true,
                    message: "No associated upsell found."
                }
            } else {
                await appDatabase.transaction(async (transactionalEntityManager: EntityManager) => {
                    let upSellToUpdate = await transactionalEntityManager.findOne(UpSellEntity, {
                        where: {
                            upSellId: upSellId,
                            isActive: true
                        }
                    })
                    await transactionalEntityManager.update(UpSellListing,
                        { upSellId: upSellId }, { status: 0 });
                    // Update status in the retrieved UpSellEntity
                    upSellToUpdate.isActive = false;
                    await transactionalEntityManager.update(
                        UpSellEntity,
                        upSellId,
                        upSellToUpdate
                    );
                })
                return {
                    status: true,
                    message: "Data deleted successfully!!!"
                }
            }
        } catch (error) {
            throw new Error(error)
        }
    }


    async deleteMultipleUpSells(request: Request, response: Response) {
        try {
            const { upSellIds } = request.body;
            const invalidUpSellIds: any[] = [];

            await appDatabase.transaction(async (transactionalEntityManager: EntityManager) => {
                await Promise.all(upSellIds.map(async (data: any) => {
                    const upSell = await transactionalEntityManager.findOne(UpSellEntity, {
                        where: {
                            upSellId: data,
                            isActive: true
                        }
                    });
                    if (!upSell) {
                        invalidUpSellIds.push(data);
                    } else {
                        // Update records in UpSellListing table
                        await transactionalEntityManager.update(
                            UpSellListing,
                            { upSellId: data },
                            { status: 0 }
                        );

                        // Update status in the retrieved UpSellEntity
                        upSell.isActive = false;
                        await transactionalEntityManager.save(upSell);
                    }
                }));
            });

            if (invalidUpSellIds.length > 0) {
                return {
                    status: false,
                    message: "Please provide all valid upsell!!!",
                    data: invalidUpSellIds
                };
            } else {
                return {
                    status: true,
                    message: "Data deleted successfully!!!"
                };
            }
        } catch (error) {
            console.error(error);
        }
    }


    async getUpSellAssociatedListing(request: Request, response: Response) {
        try {

            const upSellId: any = request.query.upSellId

            //check for existing upsell
            const data = await this.upSellRepository.findOne({
                where: {
                    upSellId: upSellId,
                    isActive: true
                }
            })

            if (!data) {
                return {
                    status: true,
                    message: "No associated upsell found."
                }
            } else {

                let upSellListing: any[] = []
                let listingData = await this.upSellListings.find({
                    where: {
                        upSellId: upSellId,
                        status: 1
                    },
                })
                if (Array.isArray(listingData)) {
                    await Promise.all(listingData.map(async (data: any) => {
                        const listingsInfo: any = await this.listingInfoRepository.find({
                            where: { listingId: data.listingId }
                        });
                        listingsInfo[0].status = 1
                        upSellListing.push(listingsInfo[0])
                    }))
                    return {
                        status: true,
                        data: upSellListing
                    };
                } else {
                    return {
                        status: true,
                        message: "No associated listing found for given upsell."
                    }
                }

            }

        } catch (error) {
            throw new Error(error)
        }
    }
}