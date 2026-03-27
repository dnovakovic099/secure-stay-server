import { Hostify } from "../client/Hostify";
import { appDatabase } from "../utils/database.util";
import { Listing } from "../entity/Listing";
import logger from "../utils/logger.utils";

type NormalizedChargeType = string[];

interface HostifyExtraProperty {
  listingId: number | null;
  name: string;
  nickname: string | null;
  address: string | null;
}

interface HostifyExtraRecord {
  id: string;
  feeId: string;
  name: string;
  amount: number | null;
  currency: string | null;
  chargeTypes: NormalizedChargeType;
  system: boolean | null;
  status: string | null;
  image: string | null;
  settings: Record<string, unknown>;
  attachedProperties: HostifyExtraProperty[];
  raw: Record<string, unknown>;
}

const POSSIBLE_EXTRA_KEYS = [
  "fees",
  "fee",
  "extras",
  "extra",
  "propertyUpsells",
  "upsells",
  "upSells",
  "up_sell",
  "optional_fees",
  "optionalFees",
  "additional_services",
  "additionalServices",
] as const;

const META_KEYS = new Set([
  "id",
  "fee_id",
  "name",
  "title",
  "label",
  "price",
  "amount",
  "fee",
  "currency",
  "charge_type",
  "chargeType",
  "type",
  "status",
  "active",
  "is_active",
  "system",
  "is_system",
  "image",
  "image_url",
  "icon",
  "photo",
  "listing_ids",
  "listingIds",
  "listing_id",
  "listingId",
]);

export class HostifyExtrasService {
  private hostifyClient = new Hostify();
  private listingRepository = appDatabase.getRepository(Listing);

  private toText(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value).trim();
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^0-9.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private normalizeName(item: Record<string, unknown>): string {
    return (
      this.toText(item.name) ||
      this.toText(item.title) ||
      this.toText(item.label) ||
      this.toText(item.description) ||
      "Unnamed Extra"
    );
  }

  private normalizeChargeTypes(item: Record<string, unknown>): string[] {
    const source = item.charge_type ?? item.chargeType ?? item.type ?? item.feeType ?? item.timePeriod;

    if (Array.isArray(source)) {
      return source
        .map((entry) => {
          if (typeof entry === "object" && entry && !Array.isArray(entry)) {
            const record = entry as Record<string, unknown>;
            return this.toText(record.name ?? record.label ?? record.title ?? record.value);
          }
          return this.toText(entry);
        })
        .filter(Boolean);
    }

    const text = this.toText(source);
    if (!text) {
      return [];
    }

    return text
      .split(/[|,/]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private normalizeStatus(item: Record<string, unknown>): string | null {
    if (typeof item.status === "string" && item.status.trim()) {
      return item.status.trim();
    }

    if (typeof item.status === "number") {
      return item.status === 1 ? "Active" : "Inactive";
    }

    if (typeof item.active === "boolean") {
      return item.active ? "Active" : "Inactive";
    }

    if (typeof item.is_active === "boolean") {
      return item.is_active ? "Active" : "Inactive";
    }

    if (typeof item.active === "number") {
      return item.active === 1 ? "Active" : "Inactive";
    }

    if (typeof item.is_active === "number") {
      return item.is_active === 1 ? "Active" : "Inactive";
    }

    return null;
  }

  private normalizeSystem(item: Record<string, unknown>): boolean | null {
    if (typeof item.system === "boolean") {
      return item.system;
    }
    if (typeof item.is_system === "boolean") {
      return item.is_system;
    }
    if (typeof item.system === "number") {
      return item.system === 1;
    }
    if (typeof item.is_system === "number") {
      return item.is_system === 1;
    }
    if (typeof item.system === "string") {
      const normalized = item.system.trim().toLowerCase();
      if (["yes", "true", "1", "system"].includes(normalized)) {
        return true;
      }
      if (["no", "false", "0", "custom"].includes(normalized)) {
        return false;
      }
    }
    if (typeof item.is_system === "string") {
      const normalized = item.is_system.trim().toLowerCase();
      if (["yes", "true", "1", "system"].includes(normalized)) {
        return true;
      }
      if (["no", "false", "0", "custom"].includes(normalized)) {
        return false;
      }
    }
    return null;
  }

  private normalizeImage(item: Record<string, unknown>): string | null {
    return (
      this.toText(item.image) ||
      this.toText(item.image_url) ||
      this.toText(item.icon) ||
      this.toText(item.photo) ||
      null
    );
  }

  private normalizeId(item: Record<string, unknown>, fallbackName: string): string {
    const possibleId =
      item.id ??
      item.fee_id ??
      item.feeId ??
      item.extra_id ??
      item.extraId ??
      item.code;

    const value = this.toText(possibleId);
    return value || fallbackName.toLowerCase().replace(/\s+/g, "-");
  }

  private extractSettings(item: Record<string, unknown>): Record<string, unknown> {
    return Object.entries(item).reduce<Record<string, unknown>>((acc, [key, value]) => {
      if (!META_KEYS.has(key) && value !== null && value !== undefined && value !== "") {
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  private getCandidateExtraArrays(payload: Record<string, unknown>): Record<string, unknown>[][] {
    return POSSIBLE_EXTRA_KEYS.flatMap((key) => {
      const candidate = payload[key];
      if (!Array.isArray(candidate)) {
        return [];
      }

      return [
        candidate.filter(
          (entry): entry is Record<string, unknown> =>
            !!entry && typeof entry === "object" && !Array.isArray(entry)
        ),
      ];
    }).filter((items) => items.length > 0);
  }

  private listingMatchesExtra(
    listingExtra: Record<string, unknown>,
    extraId: string,
    extraName: string
  ): boolean {
    const candidateId = this.toText(
      listingExtra.id ??
        listingExtra.fee_id ??
        listingExtra.feeId ??
        listingExtra.extra_id ??
        listingExtra.extraId
    );

    if (candidateId && candidateId === extraId) {
      return true;
    }

    const candidateName = this.normalizeName(listingExtra).toLowerCase();
    return Boolean(candidateName && candidateName === extraName.toLowerCase());
  }

  private async getLocalListingMap() {
    const localListings = await this.listingRepository.find({
      select: ["id", "name", "internalListingName", "address"],
    });

    return new Map<number, Listing>(localListings.map((listing) => [Number(listing.id), listing]));
  }

  private resolveListingMeta(listing: Record<string, unknown>, localListingMap: Map<number, Listing>): HostifyExtraProperty {
    const listingId = this.toNumber(listing.id ?? listing.listing_id ?? listing.listingId);
    const localListing = listingId ? localListingMap.get(Number(listingId)) : undefined;

    return {
      listingId: listingId ? Number(listingId) : null,
      name:
        this.toText(listing.name) ||
        this.toText(listing.nickname) ||
        localListing?.name ||
        localListing?.internalListingName ||
        "Unknown Property",
      nickname:
        this.toText(listing.nickname) ||
        localListing?.internalListingName ||
        null,
      address:
        this.toText(listing.address) ||
        localListing?.address ||
        null,
    };
  }

  private extractDirectAttachmentIds(item: Record<string, unknown>): number[] {
    const rawIds =
      item.listing_ids ??
      item.listingIds ??
      item.listings ??
      item.listing_id ??
      item.listingId;

    if (Array.isArray(rawIds)) {
      return rawIds
        .map((entry) => this.toNumber(typeof entry === "object" && entry ? (entry as Record<string, unknown>).id ?? entry : entry))
        .filter((entry): entry is number => entry !== null);
    }

    const single = this.toNumber(rawIds);
    return single !== null ? [single] : [];
  }

  private async buildExtraAttachmentMap(
    apiKey: string,
    extras: HostifyExtraRecord[],
    localListingMap: Map<number, Listing>
  ): Promise<Map<string, HostifyExtraProperty[]>> {
    const attachmentMap = new Map<string, HostifyExtraProperty[]>();
    const listings = await this.hostifyClient.getListings(apiKey);

    const listingDetails = await Promise.all(
      listings.map(async (listing) => {
        const listingId = this.toText(listing?.id);
        if (!listingId) {
          return null;
        }

        const detail = await this.hostifyClient.getListingDetails(apiKey, listingId);
        return detail?.listing || listing;
      })
    );

    for (const listing of listingDetails) {
      if (!listing || typeof listing !== "object") {
        continue;
      }

      const listingRecord = listing as Record<string, unknown>;
      const listingMeta = this.resolveListingMeta(listingRecord, localListingMap);
      const candidateArrays = this.getCandidateExtraArrays(listingRecord);

      for (const extra of extras) {
        const isAttached = candidateArrays.some((entries) =>
          entries.some((entry) => this.listingMatchesExtra(entry, extra.id, extra.name))
        );

        if (!isAttached) {
          continue;
        }

        const current = attachmentMap.get(extra.id) || [];
        if (!current.some((item) => item.listingId === listingMeta.listingId && item.name === listingMeta.name)) {
          current.push(listingMeta);
          attachmentMap.set(extra.id, current);
        }
      }
    }

    return attachmentMap;
  }

  async getHostifyExtras(): Promise<HostifyExtraRecord[]> {
    const apiKey = process.env.HOSTIFY_API_KEY || "";
    if (!apiKey) {
      throw new Error("Hostify API key not configured");
    }

    const [rawExtras, localListingMap] = await Promise.all([
      this.hostifyClient.getExtras(apiKey),
      this.getLocalListingMap(),
    ]);

    const extras = rawExtras
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => {
        const name = this.normalizeName(entry);
        const id = this.normalizeId(entry, name);

        return {
          id,
          feeId: this.toText(entry.fee_id ?? entry.feeId ?? entry.id ?? id),
          name,
          amount: this.toNumber(
            entry.amount ??
            entry.price ??
            entry.fee ??
            (typeof entry.amount === "object" && entry.amount ? (entry.amount as Record<string, unknown>).amount : undefined) ??
            (typeof entry.price === "object" && entry.price ? (entry.price as Record<string, unknown>).amount : undefined)
          ),
          currency: this.toText(
            entry.currency ??
            (typeof entry.price === "object" && entry.price ? (entry.price as Record<string, unknown>).currency : undefined) ??
            (typeof entry.amount === "object" && entry.amount ? (entry.amount as Record<string, unknown>).currency : undefined)
          ) || null,
          chargeTypes: this.normalizeChargeTypes(entry),
          system: this.normalizeSystem(entry),
          status: this.normalizeStatus(entry),
          image: this.normalizeImage(entry),
          settings: this.extractSettings(entry),
          attachedProperties: [],
          raw: entry,
        };
      });

    const uniqueExtras = Array.from(
      extras.reduce((acc, extra) => {
        const key = `${extra.id}::${extra.name.toLowerCase()}`;
        if (!acc.has(key)) {
          acc.set(key, extra);
        }
        return acc;
      }, new Map<string, HostifyExtraRecord>()).values()
    );

    const attachmentMap = await this.buildExtraAttachmentMap(apiKey, uniqueExtras, localListingMap);

    return uniqueExtras
      .map((extra) => ({
        ...extra,
        attachedProperties: (() => {
          const directAttachmentIds = this.extractDirectAttachmentIds(extra.raw);
          const directAttachments = directAttachmentIds
            .map((listingId) => {
              const listing = localListingMap.get(listingId);
              if (!listing) {
                return null;
              }
              return {
                listingId,
                name: listing.name,
                nickname: listing.internalListingName || null,
                address: listing.address || null,
              };
            })
            .filter((entry): entry is HostifyExtraProperty => entry !== null);

          const scannedAttachments = attachmentMap.get(extra.id) || [];
          const merged = [...directAttachments];

          scannedAttachments.forEach((attachment) => {
            if (!merged.some((existing) => existing.listingId === attachment.listingId && existing.name === attachment.name)) {
              merged.push(attachment);
            }
          });

          return merged;
        })(),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}

export default new HostifyExtrasService();
