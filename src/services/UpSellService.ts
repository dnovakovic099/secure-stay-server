import { EntityManager, In, Like } from "typeorm";
import { UpSellEntity } from "../entity/UpSell";
import { appDatabase } from "../utils/database.util";
import { Request, Response } from "express";
import { UpSellListing } from "../entity/UpSellListing";
import { Listing } from "../entity/Listing";
import { UpSellPropertyConfig } from "../entity/UpSellPropertyConfig";

export class UpSellServices {
  private upSellRepository = appDatabase.getRepository(UpSellEntity);
  private upSellListings = appDatabase.getRepository(UpSellListing);
  private listingInfoRepository = appDatabase.getRepository(Listing);
  private upSellPropertyConfigRepository = appDatabase.getRepository(UpSellPropertyConfig);

  private parseArrayField<T>(value: unknown): T[] {
    if (Array.isArray(value)) {
      return value as T[];
    }

    if (typeof value === "string" && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    return [];
  }

  private normalizeNullableString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized ? normalized : null;
  }

  private normalizeNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
  }

  private normalizePropertyConfigs(value: unknown) {
    return this.parseArrayField<any>(value)
      .map((item) => ({
        listingId: Number(item?.listingId),
        serviceType: this.normalizeNullableString(item?.serviceType),
        actualFee: this.normalizeNullableNumber(item?.actualFee),
        processingFee: this.normalizeNullableNumber(item?.processingFee),
        chargeType: this.normalizeNullableString(item?.chargeType),
        upsellFee: this.normalizeNullableNumber(item?.upsellFee),
        internalNotes: this.normalizeNullableString(item?.internalNotes),
      }))
      .filter((item) => Number.isFinite(item.listingId) && item.listingId > 0);
  }

  async saveUpSellInfo(request: Request, response: Response) {
    try {
      let { listingIds, propertyConfigs, ...upSellInfo } = request.body;
      if (request.file)
        upSellInfo = {
          ...upSellInfo,
          image: `uploads/${request.file.filename}`,
        };

      const normalizedPropertyConfigs = this.normalizePropertyConfigs(propertyConfigs);
      const normalizedListingIds = Array.from(
        new Set(
          (
            normalizedPropertyConfigs.length
              ? normalizedPropertyConfigs.map((item) => item.listingId)
              : this.parseArrayField<number | string>(listingIds).map((listingId) => Number(listingId))
          ).filter((listingId) => Number.isFinite(listingId) && Number(listingId) > 0)
        )
      );

      await appDatabase.transaction(async (transactionalEntityManager) => {
        const savedUpSell = await transactionalEntityManager.save(UpSellEntity, upSellInfo);
        //saving listing to associated upSell

        if (normalizedListingIds.length) {
          await Promise.all(
            normalizedListingIds.map(async (listingId: number) => {
              const upSellListing = new UpSellListing();
              upSellListing.listingId = listingId;
              upSellListing.upSellId = savedUpSell.upSellId;
              upSellListing.status = 1;
              await transactionalEntityManager.save(upSellListing);
            })
          );
        }

        if (normalizedPropertyConfigs.length) {
          await Promise.all(
            normalizedPropertyConfigs.map(async (config) => {
              const propertyConfig = new UpSellPropertyConfig();
              propertyConfig.upSellId = Number(savedUpSell.upSellId);
              propertyConfig.listingId = config.listingId;
              propertyConfig.serviceType = config.serviceType;
              propertyConfig.actualFee = config.actualFee;
              propertyConfig.processingFee = config.processingFee;
              propertyConfig.chargeType = config.chargeType;
              propertyConfig.upsellFee = config.upsellFee;
              propertyConfig.internalNotes = config.internalNotes;
              await transactionalEntityManager.save(propertyConfig);
            })
          );
        }
      });

      return {
        status: true,
        message: "Data saved successfully!!!",
      };
    } catch (error) {
      throw new Error(error);
    }
  }

  async updateUpSellInfo(request: Request, response: Response) {
    try {
      let { listingIds, propertyConfigs, ...upSellInfo } = request.body;
      if (request.file)
        upSellInfo = {
          ...upSellInfo,
          image: `uploads/${request.file.filename}`,
        };
      const normalizedPropertyConfigs = this.normalizePropertyConfigs(propertyConfigs);
      const normalizedListingIds = Array.from(
        new Set(
          (
            normalizedPropertyConfigs.length
              ? normalizedPropertyConfigs.map((item) => item.listingId)
              : this.parseArrayField<number | string>(listingIds).map((listingId) => Number(listingId))
          ).filter((listingId) => Number.isFinite(listingId) && Number(listingId) > 0)
        )
      );
      //check for existing upsell
      const data = await this.upSellRepository.findOne({
        where: {
          upSellId: upSellInfo.upSellId,
          isActive: true,
        },
      });

      if (!data) {
        return {
          status: true,
          message: "No associated upsell found!!!",
        };
      } else {
        await appDatabase.transaction(async (transactionalEntityManager) => {
          // Update UpSellEntity
          await transactionalEntityManager.update(
            UpSellEntity,
            upSellInfo.upSellId,
            upSellInfo
          );

          // check either listing are present in the api request
          if (normalizedListingIds.length) {
            // Update UpSellListing status to 0
            await transactionalEntityManager.update(
              UpSellListing,
              { upSellId: upSellInfo.upSellId },
              { status: 0 }
            );
            // Save new UpSellListing records
            await Promise.all(
              normalizedListingIds.map(async (listingId: number) => {
                const upSellListing = new UpSellListing();
                upSellListing.listingId = listingId;
                upSellListing.upSellId = upSellInfo.upSellId;
                upSellListing.status = 1;
                await transactionalEntityManager.save(upSellListing);
              })
            );
          }

          await transactionalEntityManager.delete(UpSellPropertyConfig, {
            upSellId: Number(upSellInfo.upSellId),
          });

          if (normalizedPropertyConfigs.length) {
            await Promise.all(
              normalizedPropertyConfigs.map(async (config) => {
                const propertyConfig = new UpSellPropertyConfig();
                propertyConfig.upSellId = Number(upSellInfo.upSellId);
                propertyConfig.listingId = config.listingId;
                propertyConfig.serviceType = config.serviceType;
                propertyConfig.actualFee = config.actualFee;
                propertyConfig.processingFee = config.processingFee;
                propertyConfig.chargeType = config.chargeType;
                propertyConfig.upsellFee = config.upsellFee;
                propertyConfig.internalNotes = config.internalNotes;
                await transactionalEntityManager.save(propertyConfig);
              })
            );
          }
        });

        return {
          status: true,
          message: "Data updated successfully!!!",
        };
      }
    } catch (error) {
      throw new Error(error);
    }
  }

  async updateMultipleSellStatus(request: Request, response: Response) {
    const { upSellId, status } = request.body;

    //check for multiple upsell ids
    if (Array.isArray(upSellId)) {
      const invalidUpSellIds: any[] = [];
      await appDatabase.transaction(
        async (transactionalEntityManager: EntityManager) => {
          await Promise.all(
            upSellId.map(async (data: any) => {
              //check for active upsells
              const upSell = await transactionalEntityManager.findOne(
                UpSellEntity,
                {
                  where: {
                    upSellId: data,
                    isActive: true,
                  },
                }
              );
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
            })
          );
        }
      );

      if (invalidUpSellIds.length > 0) {
        //error message for invalid upsell
        return {
          status: false,
          message: "Please provide valid upsells id",
          invalidIds: invalidUpSellIds,
        };
      } else {
        return {
          status: true,
          message: "Data updated successfully!!!",
        };
      }
    } else {
      return {
        status: true,
        message: "Please provide upsell in array!!!",
      };
    }
  }

  async getUpSellInfo(request: Request, response: Response) {
    try {
      const page: any = request.query.page || 1;
      const limit: any = request.query.limit || 10;
      const title =
        request.query.title !== undefined ? request.query.title : "";
      const offset: any = (page - 1) * limit;

      let upSellInfo = await this.upSellRepository.findAndCount({
        where: {
          title: Like(`%${title}%`),
          isActive: true,
        },
        take: limit,
        skip: offset,
        order: {
          upSellId: "DESC",
        },
      });
      const totalCount = await this.upSellRepository.count({
        where: {
          title: Like(`%${title}%`),
          isActive: true,
        },
      });

      const totalActive = await this.upSellRepository.count({
        where: {
          title: Like(`%${title}%`),
          isActive: true,
          status: true,
        },
      });

      return {
        status: true,
        data: upSellInfo[0],
        length: totalCount,
        totalActive,
      };
    } catch (error) {
      throw new Error(error);
    }
  }

  async getUpSellById(request: Request, response: Response) {
    try {
      const upSellId: any = request.query.upSellId;
      let upSellInfo = await this.upSellRepository.findOne({
        where: {
          upSellId: upSellId,
          isActive: true,
        },
      });
      if (upSellInfo) {
        return {
          status: true,
          data: upSellInfo,
        };
      } else {
        return {
          status: true,
          message: "Provide valid upsell!!!",
        };
      }
    } catch (error) {
      throw new Error(error);
    }
  }

  async deleteUpSellInfo(request: Request, response: Response) {
    try {
      const upSellId: any = request.query.upSellId;

      // check either upsell is present in the table
      const data = await this.upSellRepository.findOne({
        where: {
          upSellId: upSellId,
          isActive: true,
        },
      });
      if (!data) {
        return {
          status: true,
          message: "No associated upsell found.",
        };
      } else {
        await appDatabase.transaction(
          async (transactionalEntityManager: EntityManager) => {
            let upSellToUpdate = await transactionalEntityManager.findOne(
              UpSellEntity,
              {
                where: {
                  upSellId: upSellId,
                  isActive: true,
                },
              }
            );
            await transactionalEntityManager.update(
              UpSellListing,
              { upSellId: upSellId },
              { status: 0 }
            );
            // Update status in the retrieved UpSellEntity
            upSellToUpdate.isActive = false;
            await transactionalEntityManager.update(
              UpSellEntity,
              upSellId,
              upSellToUpdate
            );
          }
        );
        return {
          status: true,
          message: "Data deleted successfully!!!",
        };
      }
    } catch (error) {
      throw new Error(error);
    }
  }

  async deleteMultipleUpSells(request: Request, response: Response) {
    try {
      const { upSellIds } = request.body;
      const invalidUpSellIds: any[] = [];

      await appDatabase.transaction(
        async (transactionalEntityManager: EntityManager) => {
          await Promise.all(
            upSellIds.map(async (data: any) => {
              const upSell = await transactionalEntityManager.findOne(
                UpSellEntity,
                {
                  where: {
                    upSellId: data,
                    isActive: true,
                  },
                }
              );
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
            })
          );
        }
      );

      if (invalidUpSellIds.length > 0) {
        return {
          status: false,
          message: "Please provide all valid upsell!!!",
          data: invalidUpSellIds,
        };
      } else {
        return {
          status: true,
          message: "Data deleted successfully!!!",
        };
      }
    } catch (error) {
      console.error(error);
    }
  }

  async getUpSellAssociatedListing(request: Request, response: Response) {
    try {
      const upSellId: any = request.query.upSellId;

      //check for existing upsell
      const data = await this.upSellRepository.findOne({
        where: {
          upSellId: upSellId,
          isActive: true,
        },
      });

      if (!data) {
        return {
          status: true,
          message: "No associated upsell found.",
        };
      } else {
        let upSellListing: any[] = [];
        let listingData = await this.upSellListings.find({
          where: {
            upSellId: upSellId,
            status: 1,
          },
        });
        const propertyConfigs = await this.upSellPropertyConfigRepository.find({
          where: {
            upSellId: Number(upSellId),
          },
        });
        const propertyConfigMap = new Map(
          propertyConfigs.map((config) => [Number(config.listingId), config])
        );
        if (Array.isArray(listingData)) {
          await Promise.all(
            listingData.map(async (data: any) => {
              const listingsInfo: any = await this.listingInfoRepository.find({
                where: { id: data.listingId },
              });
              const listingInfo = listingsInfo[0];
              if (!listingInfo) {
                return;
              }
              const propertyConfig = propertyConfigMap.get(Number(data.listingId));
              listingInfo.status = 1;
              listingInfo.serviceType = propertyConfig?.serviceType ?? null;
              listingInfo.actualFee = propertyConfig?.actualFee ?? null;
              listingInfo.processingFee = propertyConfig?.processingFee ?? null;
              listingInfo.chargeType = propertyConfig?.chargeType ?? null;
              listingInfo.upsellFee = propertyConfig?.upsellFee ?? null;
              listingInfo.internalNotes = propertyConfig?.internalNotes ?? null;
              upSellListing.push(listingInfo);
            })
          );
          return {
            status: true,
            data: upSellListing,
          };
        } else {
          return {
            status: true,
            message: "No associated listing found for given upsell.",
          };
        }
      }
    } catch (error) {
      throw new Error(error);
    }
  }
}
