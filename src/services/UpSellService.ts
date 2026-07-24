import { EntityManager, In, Like } from "typeorm";
import { UpSellEntity } from "../entity/UpSell";
import { appDatabase } from "../utils/database.util";
import { Request, Response } from "express";
import { UpSellListing } from "../entity/UpSellListing";
import { Listing } from "../entity/Listing";
import { UpSellPropertyConfig } from "../entity/UpSellPropertyConfig";
import { UpSellPropertyConfigHistory } from "../entity/UpSellPropertyConfigHistory";
import { QuoteService } from "./QuoteService";

interface NormalizedPropertyConfig {
  listingId: number;
  serviceType: string | null;
  pmFee: number | null;
  actualFee: number | null;
  processingFee: number | null;
  chargeType: string | null;
  rateConfiguration: string | null;
  pricingRules: string | null;
  upsellFee: number | null;
  taxable: boolean;
  pairSyncStatus: string | null;
  pairSyncAction: "sync" | "unsync" | null;
  source: string | null;
  sdto: string | null;
  internalNotes: string | null;
  description: string | null;
  image: string | null;
}

type PropertyConfigHistoryAction = "CREATE" | "UPDATE" | "DELETE" | "SYNC" | "UNSYNC";

export class UpSellServices {
  private upSellRepository = appDatabase.getRepository(UpSellEntity);
  private upSellListings = appDatabase.getRepository(UpSellListing);
  private listingInfoRepository = appDatabase.getRepository(Listing);
  private upSellPropertyConfigRepository = appDatabase.getRepository(UpSellPropertyConfig);
  private upSellPropertyConfigHistoryRepository = appDatabase.getRepository(UpSellPropertyConfigHistory);
  private quoteService = new QuoteService();

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

  private normalizeBoolean(value: unknown): boolean {
    if (value === true || value === 1) return true;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return normalized === "true" || normalized === "1" || normalized === "yes";
    }
    return false;
  }

  private normalizePropertyConfigs(value: unknown): NormalizedPropertyConfig[] {
    const configs = this.parseArrayField<any>(value)
      .map((item) => ({
        listingId: Number(item?.listingId),
        serviceType: this.normalizeNullableString(item?.serviceType),
        pmFee: this.normalizeNullableNumber(item?.pmFee),
        actualFee: this.normalizeNullableNumber(item?.actualFee),
        processingFee: this.normalizeNullableNumber(item?.processingFee),
        chargeType: this.normalizeNullableString(item?.chargeType),
        rateConfiguration: this.normalizeNullableString(item?.rateConfiguration),
        pricingRules: this.normalizeNullableString(item?.pricingRules),
        upsellFee: this.normalizeNullableNumber(item?.upsellFee),
        taxable: this.normalizeBoolean(item?.taxable),
        pairSyncStatus: this.normalizePairSyncStatus(item?.pairSyncStatus),
        pairSyncAction: this.normalizePairSyncAction(item?.pairSyncAction),
        source: this.normalizeSource(item?.source),
        sdto: this.normalizeNullableString(item?.sdto),
        internalNotes: this.normalizeNullableString(item?.internalNotes),
        description: this.normalizeNullableString(item?.description),
        image: this.normalizeNullableString(item?.image),
      }))
      .filter((item) => Number.isFinite(item.listingId) && item.listingId > 0);

    return Array.from(
      configs.reduce((deduped, config) => deduped.set(config.listingId, config), new Map<number, NormalizedPropertyConfig>()).values()
    );
  }

  private normalizeSource(value: unknown): string | null {
    const normalized = this.normalizeNullableString(value);
    if (!normalized) return null;
    const lower = normalized.toLowerCase();
    if (lower === "ll") return "LL";
    if (lower === "client") return "Client";
    return normalized;
  }

  private normalizePairSyncStatus(value: unknown): string | null {
    const normalized = this.normalizeNullableString(value)?.toLowerCase();
    if (normalized === "synced" || normalized === "unsynced") return normalized;
    return null;
  }

  private normalizePairSyncAction(value: unknown): "sync" | "unsync" | null {
    const normalized = this.normalizeNullableString(value)?.toLowerCase();
    if (normalized === "sync" || normalized === "unsync") return normalized;
    return null;
  }

  private normalizeUpsellTitle(value: unknown): string {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  private isProtectedPairedUpsellTitle(title: unknown): boolean {
    const normalized = this.normalizeUpsellTitle(title);
    return (
      normalized.includes("check") &&
      (normalized.includes("early") || normalized.includes("late"))
    );
  }

  private getPairedUpsellTitle(title: unknown): string | null {
    const normalized = this.normalizeUpsellTitle(title);

    if (normalized.includes("early") && normalized.includes("check")) return "Late Check-Out";
    if (normalized.includes("late") && normalized.includes("check")) return "Early Check-In";
    return null;
  }

  private getRequestUserId(request: Request): string {
    const user = (request as any)?.user;
    return String(user?.id || user?.email || user?.name || "System");
  }

  private stringifyHistoryValue(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") {
      return Number.isFinite(value) ? String(Number(value.toFixed(4))) : null;
    }
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  private normalizeComparableHistoryValue(value: unknown): string {
    const stringValue = this.stringifyHistoryValue(value);
    if (stringValue === null) return "";
    const numericValue = Number(stringValue);
    if (Number.isFinite(numericValue) && stringValue.trim() !== "") {
      return String(Number(numericValue.toFixed(4)));
    }
    return stringValue.trim();
  }

  private snapshotPropertyConfig(config: UpSellPropertyConfig | NormalizedPropertyConfig) {
    return {
      serviceType: config.serviceType ?? null,
      pmFee: this.stringifyHistoryValue(config.pmFee),
      actualFee: this.stringifyHistoryValue(config.actualFee),
      processingFee: this.stringifyHistoryValue(config.processingFee),
      chargeType: config.chargeType ?? null,
      rateConfiguration: config.rateConfiguration ?? null,
      pricingRules: config.pricingRules ?? null,
      upsellFee: this.stringifyHistoryValue(config.upsellFee),
      taxable: Boolean(config.taxable),
      pairSyncStatus: config.pairSyncStatus ?? null,
      source: config.source ?? null,
      sdto: config.sdto ?? null,
      internalNotes: config.internalNotes ?? null,
      description: config.description ?? null,
      image: config.image ?? null,
    };
  }

  private getTrackedPropertyConfigFields(): Array<keyof ReturnType<UpSellServices["snapshotPropertyConfig"]>> {
    return [
      "serviceType",
      "pmFee",
      "actualFee",
      "processingFee",
      "chargeType",
      "rateConfiguration",
      "pricingRules",
      "upsellFee",
      "taxable",
      "pairSyncStatus",
      "source",
      "sdto",
      "internalNotes",
      "description",
      "image",
    ];
  }

  private async createPropertyConfigHistoryEntry(
    transactionalEntityManager: EntityManager,
    upSellId: number,
    listingId: number,
    changedBy: string,
    action: PropertyConfigHistoryAction,
    fieldName: string | null,
    oldValue: unknown,
    newValue: unknown
  ) {
    const historyEntry = new UpSellPropertyConfigHistory();
    historyEntry.upSellId = upSellId;
    historyEntry.listingId = listingId;
    historyEntry.changedBy = changedBy || "System";
    historyEntry.action = action;
    historyEntry.fieldName = fieldName;
    historyEntry.oldValue = this.stringifyHistoryValue(oldValue);
    historyEntry.newValue = this.stringifyHistoryValue(newValue);
    await transactionalEntityManager.save(historyEntry);
  }

  private async recordPropertyConfigDiffs(
    transactionalEntityManager: EntityManager,
    upSellId: number,
    previousConfigs: UpSellPropertyConfig[],
    nextConfigs: NormalizedPropertyConfig[],
    changedBy: string,
    actionOverride?: PropertyConfigHistoryAction
  ) {
    const previousByListingId = new Map(previousConfigs.map((config) => [Number(config.listingId), config]));
    const nextByListingId = new Map(nextConfigs.map((config) => [Number(config.listingId), config]));
    const listingIds = Array.from(new Set([...previousByListingId.keys(), ...nextByListingId.keys()]));

    for (const listingId of listingIds) {
      const previousConfig = previousByListingId.get(listingId);
      const nextConfig = nextByListingId.get(listingId);

      if (!previousConfig && nextConfig) {
        await this.createPropertyConfigHistoryEntry(
          transactionalEntityManager,
          upSellId,
          listingId,
          changedBy,
          actionOverride || "CREATE",
          "configuration",
          null,
          this.snapshotPropertyConfig(nextConfig)
        );
        continue;
      }

      if (previousConfig && !nextConfig) {
        await this.createPropertyConfigHistoryEntry(
          transactionalEntityManager,
          upSellId,
          listingId,
          changedBy,
          "DELETE",
          "configuration",
          this.snapshotPropertyConfig(previousConfig),
          null
        );
        continue;
      }

      if (!previousConfig || !nextConfig) continue;

      const previousSnapshot = this.snapshotPropertyConfig(previousConfig);
      const nextSnapshot = this.snapshotPropertyConfig(nextConfig);
      for (const fieldName of this.getTrackedPropertyConfigFields()) {
        if (this.normalizeComparableHistoryValue(previousSnapshot[fieldName]) === this.normalizeComparableHistoryValue(nextSnapshot[fieldName])) {
          continue;
        }

        const fieldAction =
          fieldName === "pairSyncStatus" && nextSnapshot[fieldName] === "synced"
            ? "SYNC"
            : fieldName === "pairSyncStatus" && nextSnapshot[fieldName] === "unsynced"
              ? "UNSYNC"
              : actionOverride || "UPDATE";

        await this.createPropertyConfigHistoryEntry(
          transactionalEntityManager,
          upSellId,
          listingId,
          changedBy,
          fieldAction,
          fieldName,
          previousSnapshot[fieldName],
          nextSnapshot[fieldName]
        );
      }
    }
  }

  private async recordSinglePropertyConfigDiff(
    transactionalEntityManager: EntityManager,
    upSellId: number,
    listingId: number,
    previousConfig: UpSellPropertyConfig | null,
    nextConfig: UpSellPropertyConfig | null,
    changedBy: string,
    actionOverride?: PropertyConfigHistoryAction
  ) {
    const previousConfigs = previousConfig ? [previousConfig] : [];
    const nextConfigs = nextConfig
      ? [{
          listingId,
          serviceType: nextConfig.serviceType,
          pmFee: nextConfig.pmFee === null || nextConfig.pmFee === undefined ? null : Number(nextConfig.pmFee),
          actualFee: nextConfig.actualFee === null || nextConfig.actualFee === undefined ? null : Number(nextConfig.actualFee),
          processingFee: nextConfig.processingFee === null || nextConfig.processingFee === undefined ? null : Number(nextConfig.processingFee),
          chargeType: nextConfig.chargeType,
          rateConfiguration: nextConfig.rateConfiguration,
          pricingRules: nextConfig.pricingRules,
          upsellFee: nextConfig.upsellFee === null || nextConfig.upsellFee === undefined ? null : Number(nextConfig.upsellFee),
          taxable: Boolean(nextConfig.taxable),
          pairSyncStatus: this.normalizePairSyncStatus(nextConfig.pairSyncStatus),
          pairSyncAction: null,
          source: this.normalizeSource(nextConfig.source),
          sdto: nextConfig.sdto,
          internalNotes: nextConfig.internalNotes,
          description: nextConfig.description,
          image: nextConfig.image,
        }]
      : [];

    await this.recordPropertyConfigDiffs(transactionalEntityManager, upSellId, previousConfigs, nextConfigs, changedBy, actionOverride);
  }

  private applyPropertyConfigValues(propertyConfig: UpSellPropertyConfig, config: NormalizedPropertyConfig) {
    propertyConfig.serviceType = config.serviceType;
    propertyConfig.pmFee = config.pmFee;
    propertyConfig.actualFee = config.actualFee;
    propertyConfig.processingFee = config.processingFee;
    propertyConfig.chargeType = config.chargeType;
    propertyConfig.rateConfiguration = config.rateConfiguration;
    propertyConfig.pricingRules = config.pricingRules;
    propertyConfig.upsellFee = config.upsellFee;
    propertyConfig.taxable = config.taxable;
    propertyConfig.pairSyncStatus = config.pairSyncStatus;
    propertyConfig.source = config.source;
    propertyConfig.sdto = config.sdto;
    propertyConfig.internalNotes = config.internalNotes;
    propertyConfig.description = config.description;
    propertyConfig.image = config.image;
  }

  private async syncPairedPropertyConfigs(
    transactionalEntityManager: EntityManager,
    sourceTitle: unknown,
    sourceUpSellId: number,
    propertyConfigs: NormalizedPropertyConfig[],
    changedBy: string
  ) {
    const pairedTitle = this.getPairedUpsellTitle(sourceTitle);
    if (!pairedTitle || !propertyConfigs.length) return;

    const pairedUpSell = await transactionalEntityManager
      .getRepository(UpSellEntity)
      .createQueryBuilder("upsell")
      .where("LOWER(upsell.title) = LOWER(:title)", { title: pairedTitle })
      .andWhere("upsell.isActive = :isActive", { isActive: true })
      .getOne();

    if (!pairedUpSell || Number(pairedUpSell.upSellId) === Number(sourceUpSellId)) return;

    await Promise.all(
      propertyConfigs.map(async (config) => {
        const listingId = Number(config.listingId);
        const pairedUpSellId = Number(pairedUpSell.upSellId);
        const existingConfig = await transactionalEntityManager.findOne(UpSellPropertyConfig, {
          where: { upSellId: pairedUpSellId, listingId },
        });
        const sourceConfig = await transactionalEntityManager.findOne(UpSellPropertyConfig, {
          where: { upSellId: sourceUpSellId, listingId },
        });

        if (config.pairSyncStatus === "unsynced" || config.pairSyncAction === "unsync") {
          if (sourceConfig && sourceConfig.pairSyncStatus !== "unsynced") {
            const previousSourceConfig = transactionalEntityManager.create(UpSellPropertyConfig, sourceConfig);
            sourceConfig.pairSyncStatus = "unsynced";
            await transactionalEntityManager.save(sourceConfig);
            await this.recordSinglePropertyConfigDiff(
              transactionalEntityManager,
              sourceUpSellId,
              listingId,
              previousSourceConfig,
              sourceConfig,
              changedBy,
              "UNSYNC"
            );
          }
          if (existingConfig && existingConfig.pairSyncStatus !== "unsynced") {
            const previousExistingConfig = transactionalEntityManager.create(UpSellPropertyConfig, existingConfig);
            existingConfig.pairSyncStatus = "unsynced";
            await transactionalEntityManager.save(existingConfig);
            await this.recordSinglePropertyConfigDiff(
              transactionalEntityManager,
              pairedUpSellId,
              listingId,
              previousExistingConfig,
              existingConfig,
              changedBy,
              "UNSYNC"
            );
          }
          return;
        }

        if (existingConfig?.pairSyncStatus === "unsynced" && config.pairSyncAction !== "sync") {
          if (sourceConfig && sourceConfig.pairSyncStatus !== "unsynced") {
            const previousSourceConfig = transactionalEntityManager.create(UpSellPropertyConfig, sourceConfig);
            sourceConfig.pairSyncStatus = "unsynced";
            await transactionalEntityManager.save(sourceConfig);
            await this.recordSinglePropertyConfigDiff(
              transactionalEntityManager,
              sourceUpSellId,
              listingId,
              previousSourceConfig,
              sourceConfig,
              changedBy,
              "UNSYNC"
            );
          }
          return;
        }

        const existingListing = await transactionalEntityManager.findOne(UpSellListing, {
          where: { upSellId: pairedUpSellId, listingId },
        });

        if (existingListing) {
          existingListing.status = 1;
          await transactionalEntityManager.save(existingListing);
        } else {
          const upSellListing = new UpSellListing();
          upSellListing.upSellId = pairedUpSellId;
          upSellListing.listingId = listingId;
          upSellListing.status = 1;
          await transactionalEntityManager.save(upSellListing);
        }

        const previousExistingConfig = existingConfig
          ? transactionalEntityManager.create(UpSellPropertyConfig, existingConfig)
          : null;
        const propertyConfig = existingConfig || new UpSellPropertyConfig();
        const preservedDescription = propertyConfig.description ?? null;
        const preservedImage = propertyConfig.image ?? null;
        propertyConfig.upSellId = pairedUpSellId;
        propertyConfig.listingId = listingId;
        this.applyPropertyConfigValues(propertyConfig, {
          ...config,
          pairSyncStatus: "synced",
          description: preservedDescription,
          image: preservedImage,
        });
        await transactionalEntityManager.save(propertyConfig);
        await this.recordSinglePropertyConfigDiff(
          transactionalEntityManager,
          pairedUpSellId,
          listingId,
          previousExistingConfig,
          propertyConfig,
          changedBy,
          "SYNC"
        );

        if (sourceConfig && sourceConfig.pairSyncStatus !== "synced") {
          const previousSourceConfig = transactionalEntityManager.create(UpSellPropertyConfig, sourceConfig);
          sourceConfig.pairSyncStatus = "synced";
          await transactionalEntityManager.save(sourceConfig);
          await this.recordSinglePropertyConfigDiff(
            transactionalEntityManager,
            sourceUpSellId,
            listingId,
            previousSourceConfig,
            sourceConfig,
            changedBy,
            "SYNC"
          );
        }
      })
    );
  }

  async saveUpSellInfo(request: Request, response: Response) {
    try {
      let { listingIds, propertyConfigs, ...upSellInfo } = request.body;
      const changedBy = this.getRequestUserId(request);
      if (request.file)
        upSellInfo = {
          ...upSellInfo,
          image: `uploads/${request.file.filename}`,
        };

      if (upSellInfo.isDefault !== undefined) {
        upSellInfo.isDefault = this.normalizeBoolean(upSellInfo.isDefault);
      }

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
              propertyConfig.pmFee = config.pmFee;
              propertyConfig.actualFee = config.actualFee;
              propertyConfig.processingFee = config.processingFee;
              propertyConfig.chargeType = config.chargeType;
              propertyConfig.rateConfiguration = config.rateConfiguration;
              propertyConfig.pricingRules = config.pricingRules;
              propertyConfig.upsellFee = config.upsellFee;
              propertyConfig.taxable = config.taxable;
              propertyConfig.pairSyncStatus = config.pairSyncStatus;
              propertyConfig.source = config.source;
              propertyConfig.sdto = config.sdto;
              propertyConfig.internalNotes = config.internalNotes;
              propertyConfig.description = config.description;
              propertyConfig.image = config.image;
              await transactionalEntityManager.save(propertyConfig);
            })
          );
          await this.recordPropertyConfigDiffs(
            transactionalEntityManager,
            Number(savedUpSell.upSellId),
            [],
            normalizedPropertyConfigs,
            changedBy,
            "CREATE"
          );
        }

        await this.syncPairedPropertyConfigs(
          transactionalEntityManager,
          savedUpSell.title,
          Number(savedUpSell.upSellId),
          normalizedPropertyConfigs,
          changedBy
        );
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
      const changedBy = this.getRequestUserId(request);
      if (request.file)
        upSellInfo = {
          ...upSellInfo,
          image: `uploads/${request.file.filename}`,
        };

      if (upSellInfo.isDefault !== undefined) {
        upSellInfo.isDefault = this.normalizeBoolean(upSellInfo.isDefault);
      }

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

          const previousPropertyConfigs = await transactionalEntityManager.find(UpSellPropertyConfig, {
            where: { upSellId: Number(upSellInfo.upSellId) },
          });

          await this.recordPropertyConfigDiffs(
            transactionalEntityManager,
            Number(upSellInfo.upSellId),
            previousPropertyConfigs,
            normalizedPropertyConfigs,
            changedBy
          );

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
                propertyConfig.pmFee = config.pmFee;
                propertyConfig.actualFee = config.actualFee;
                propertyConfig.processingFee = config.processingFee;
                propertyConfig.chargeType = config.chargeType;
                propertyConfig.rateConfiguration = config.rateConfiguration;
                propertyConfig.pricingRules = config.pricingRules;
                propertyConfig.upsellFee = config.upsellFee;
                propertyConfig.taxable = config.taxable;
                propertyConfig.pairSyncStatus = config.pairSyncStatus;
                propertyConfig.source = config.source;
                propertyConfig.sdto = config.sdto;
                propertyConfig.internalNotes = config.internalNotes;
                propertyConfig.description = config.description;
                propertyConfig.image = config.image;
                await transactionalEntityManager.save(propertyConfig);
              })
            );
          }

          await this.syncPairedPropertyConfigs(
            transactionalEntityManager,
            upSellInfo.title || data.title,
            Number(upSellInfo.upSellId),
            normalizedPropertyConfigs,
            changedBy
          );
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
      const changedBy = this.getRequestUserId(request);

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
      } else if (this.isProtectedPairedUpsellTitle(data.title)) {
        return {
          status: false,
          message: "Early Check-In and Late Check-Out cannot be deleted because they are protected synced upsells.",
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
            const previousPropertyConfigs = await transactionalEntityManager.find(UpSellPropertyConfig, {
              where: { upSellId: Number(upSellId) },
            });
            await this.recordPropertyConfigDiffs(
              transactionalEntityManager,
              Number(upSellId),
              previousPropertyConfigs,
              [],
              changedBy,
              "DELETE"
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
      const changedBy = this.getRequestUserId(request);
      const invalidUpSellIds: any[] = [];
      const protectedUpSellIds: any[] = [];

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
              } else if (this.isProtectedPairedUpsellTitle(upSell.title)) {
                protectedUpSellIds.push(data);
              } else {
                // Update records in UpSellListing table
                await transactionalEntityManager.update(
                  UpSellListing,
                  { upSellId: data },
                  { status: 0 }
                );
                const previousPropertyConfigs = await transactionalEntityManager.find(UpSellPropertyConfig, {
                  where: { upSellId: Number(data) },
                });
                await this.recordPropertyConfigDiffs(
                  transactionalEntityManager,
                  Number(data),
                  previousPropertyConfigs,
                  [],
                  changedBy,
                  "DELETE"
                );

                // Update status in the retrieved UpSellEntity
                upSell.isActive = false;
                await transactionalEntityManager.save(upSell);
              }
            })
          );
        }
      );

      if (protectedUpSellIds.length > 0) {
        return {
          status: false,
          message: "Early Check-In and Late Check-Out cannot be deleted because they are protected synced upsells.",
          data: protectedUpSellIds,
        };
      }

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
          const listingIds = Array.from(
            new Set(
              listingData
                .map((row: any) => Number(row.listingId))
                .filter((id) => Number.isFinite(id) && id > 0)
            )
          );

          const listingsById = new Map<number, any>();
          if (listingIds.length) {
            const listings = await this.listingInfoRepository.find({
              where: { id: In(listingIds) },
            });
            listings.forEach((listing: any) => {
              listingsById.set(Number(listing.id), listing);
            });
          }

          const taxByListingId = new Map<number, number>();
          await Promise.all(
            listingIds.map(async (listingId) => {
              try {
                const taxRate = await this.quoteService.getTaxRate(listingId);
                taxByListingId.set(listingId, Number((taxRate * 100).toFixed(2)));
              } catch {
                taxByListingId.set(listingId, 0);
              }
            })
          );

          listingData.forEach((row: any) => {
            const listingInfo = listingsById.get(Number(row.listingId));
            if (!listingInfo) return;
            const propertyConfig = propertyConfigMap.get(Number(row.listingId));
            const listingTax = taxByListingId.get(Number(row.listingId)) ?? 0;
            listingInfo.status = 1;
            listingInfo.serviceType = propertyConfig?.serviceType ?? null;
            listingInfo.pmFee = propertyConfig?.pmFee ?? null;
            listingInfo.actualFee = propertyConfig?.actualFee ?? null;
            listingInfo.processingFee = propertyConfig?.processingFee ?? null;
            listingInfo.chargeType = propertyConfig?.chargeType ?? null;
            listingInfo.rateConfiguration = propertyConfig?.rateConfiguration ?? null;
            listingInfo.pricingRules = propertyConfig?.pricingRules ?? null;
            listingInfo.upsellFee = propertyConfig?.upsellFee ?? null;
            listingInfo.tax = listingTax;
            listingInfo.taxRate = listingTax;
            listingInfo.taxable = propertyConfig?.taxable ?? false;
            listingInfo.pairSyncStatus = propertyConfig?.pairSyncStatus ?? null;
            listingInfo.source = propertyConfig?.source ?? null;
            listingInfo.sdto = propertyConfig?.sdto ?? null;
            listingInfo.internalNotes = propertyConfig?.internalNotes ?? null;
            listingInfo.description = propertyConfig?.description ?? null;
            listingInfo.image = propertyConfig?.image ?? null;
            listingInfo.createdAt = propertyConfig?.createdAt ?? null;
            listingInfo.updatedAt = propertyConfig?.updatedAt ?? null;
            upSellListing.push(listingInfo);
          });

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

  async getUpSellCatalogWithListings(request: Request, response: Response) {
    try {
      const page: any = request.query.page || 1;
      const limit: any = request.query.limit || 200;
      const title =
        request.query.title !== undefined ? request.query.title : "";
      const offset: any = (page - 1) * limit;

      const [upSells, totalCount, totalActive] = await Promise.all([
        this.upSellRepository.find({
          where: { title: Like(`%${title}%`), isActive: true },
          take: limit,
          skip: offset,
          order: { upSellId: "DESC" },
        }),
        this.upSellRepository.count({
          where: { title: Like(`%${title}%`), isActive: true },
        }),
        this.upSellRepository.count({
          where: { title: Like(`%${title}%`), isActive: true, status: true },
        }),
      ]);

      const upSellIds = upSells
        .map((row: any) => Number(row.upSellId))
        .filter((id) => Number.isFinite(id) && id > 0);

      const [allListingRows, allPropertyConfigs] = await Promise.all([
        upSellIds.length
          ? this.upSellListings.find({
              where: { upSellId: In(upSellIds), status: 1 },
            })
          : Promise.resolve([]),
        upSellIds.length
          ? this.upSellPropertyConfigRepository.find({
              where: { upSellId: In(upSellIds) },
            })
          : Promise.resolve([]),
      ]);

      const uniqueListingIds = Array.from(
        new Set(
          allListingRows
            .map((row: any) => Number(row.listingId))
            .filter((id) => Number.isFinite(id) && id > 0)
        )
      );

      const [listingRecords, taxEntries] = await Promise.all([
        uniqueListingIds.length
          ? this.listingInfoRepository.find({
              where: { id: In(uniqueListingIds) },
            })
          : Promise.resolve([]),
        Promise.all(
          uniqueListingIds.map(async (listingId) => {
            try {
              const taxRate = await this.quoteService.getTaxRate(listingId);
              return [listingId, Number((taxRate * 100).toFixed(2))] as const;
            } catch {
              return [listingId, 0] as const;
            }
          })
        ),
      ]);

      const listingsById = new Map<number, any>();
      listingRecords.forEach((listing: any) => {
        listingsById.set(Number(listing.id), listing);
      });

      const taxByListingId = new Map<number, number>(taxEntries);

      const listingsByUpSell = new Map<number, any[]>();
      allListingRows.forEach((row: any) => {
        const upSellId = Number(row.upSellId);
        if (!listingsByUpSell.has(upSellId)) listingsByUpSell.set(upSellId, []);
        listingsByUpSell.get(upSellId)!.push(row);
      });

      const propertyConfigKey = (upSellId: number, listingId: number) =>
        `${upSellId}:${listingId}`;
      const propertyConfigByKey = new Map<string, any>();
      allPropertyConfigs.forEach((config: any) => {
        propertyConfigByKey.set(
          propertyConfigKey(Number(config.upSellId), Number(config.listingId)),
          config
        );
      });

      const data = upSells.map((upSell: any) => {
        const upSellId = Number(upSell.upSellId);
        const listingRows = listingsByUpSell.get(upSellId) || [];
        const attachedProperties: any[] = [];

        listingRows.forEach((row: any) => {
          const listingId = Number(row.listingId);
          const listingInfo = listingsById.get(listingId);
          if (!listingInfo) return;
          const propertyConfig = propertyConfigByKey.get(
            propertyConfigKey(upSellId, listingId)
          );
          const listingTax = taxByListingId.get(listingId) ?? 0;

          attachedProperties.push({
            ...listingInfo,
            status: 1,
            serviceType: propertyConfig?.serviceType ?? null,
            pmFee: propertyConfig?.pmFee ?? null,
            actualFee: propertyConfig?.actualFee ?? null,
            processingFee: propertyConfig?.processingFee ?? null,
            chargeType: propertyConfig?.chargeType ?? null,
            rateConfiguration: propertyConfig?.rateConfiguration ?? null,
            pricingRules: propertyConfig?.pricingRules ?? null,
            upsellFee: propertyConfig?.upsellFee ?? null,
            tax: listingTax,
            taxRate: listingTax,
            taxable: propertyConfig?.taxable ?? false,
            pairSyncStatus: propertyConfig?.pairSyncStatus ?? null,
            source: propertyConfig?.source ?? null,
            sdto: propertyConfig?.sdto ?? null,
            internalNotes: propertyConfig?.internalNotes ?? null,
            description: propertyConfig?.description ?? null,
            image: propertyConfig?.image ?? null,
            createdAt: propertyConfig?.createdAt ?? null,
            updatedAt: propertyConfig?.updatedAt ?? null,
          });
        });

        return {
          ...upSell,
          attachedProperties,
        };
      });

      return {
        status: true,
        data,
        length: totalCount,
        totalActive,
      };
    } catch (error) {
      throw new Error(error);
    }
  }

  async getPropertyConfigHistory(request: Request, response: Response) {
    try {
      const upSellId = Number(request.query.upSellId);
      const listingId = request.query.listingId === undefined ? null : Number(request.query.listingId);

      if (!Number.isFinite(upSellId) || upSellId <= 0) {
        return {
          status: false,
          message: "Please provide a valid upsell id.",
          data: [],
        };
      }

      const where: any = { upSellId };
      if (Number.isFinite(listingId) && Number(listingId) > 0) {
        where.listingId = Number(listingId);
      }

      const history = await this.upSellPropertyConfigHistoryRepository.find({
        where,
        order: { changedAt: "DESC", id: "DESC" },
        take: Number.isFinite(Number(request.query.limit)) ? Math.min(Number(request.query.limit), 1000) : 1000,
      });

      return {
        status: true,
        data: history,
      };
    } catch (error) {
      throw new Error(error);
    }
  }
}
