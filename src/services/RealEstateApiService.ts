import axios, { AxiosError } from "axios";
import logger from "../utils/logger.utils";

const BASE_URL = "https://api.realestateapi.com";

export interface PropertySearchResult {
  id: string;
  address: {
    address: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    county?: string;
  };
  owner1FirstName: string | null;
  owner1LastName: string | null;
  owner2FirstName: string | null;
  owner2LastName: string | null;
  absenteeOwner: boolean;
  outOfStateAbsenteeOwner: boolean;
  ownerOccupied: boolean;
  corporateOwned: boolean;
  bedrooms: number | null;
  bathrooms: number | null;
  unitsCount: number | null;
  squareFeet: number | null;
  estimatedValue: number | null;
  estimatedEquity: number | null;
  equityPercent: number | null;
  suggestedRent: string | null;
  yearsOwned: number | null;
  lastSaleDate: string | null;
  lastSaleAmount: string | null;
  preForeclosure: boolean;
  auction: boolean;
  taxLien: boolean;
  priceReduced: boolean;
  mlsActive: boolean;
  mlsListingPrice: number | null;
  mlsDaysOnMarket: number | null;
  propertyType: string;
  mailAddress?: {
    address?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

export interface SkipTracePhone {
  phone: string;
  phoneDisplay: string;
  phoneType: string;
  isConnected: boolean;
  doNotCall: boolean;
}

export interface SkipTraceResult {
  fullName: string | null;
  phones: SkipTracePhone[];
  emails: string[];
  matchedVia: "property" | "mail";
}

/**
 * Thin client for realestateapi.com — county-records property search
 * (v2/PropertySearch) and owner skip tracing (v1/SkipTrace).
 *
 * Failures never throw: searches return [], traces return null, and every
 * failure is recorded in `errors` so callers can surface "the API was down /
 * out of credits" instead of silently reporting an empty day.
 */
export class RealEstateApiService {
  private readonly apiKey = process.env.REALESTATE_API_KEY || "";

  /** Human-readable failures accumulated during this instance's lifetime. */
  readonly errors: string[] = [];

  static isConfigured(): boolean {
    return Boolean(process.env.REALESTATE_API_KEY);
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
    };
  }

  private recordError(operation: string, error: any) {
    const status = error?.response?.status;
    const detail =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.response?.data?.status?.message ||
      error?.message ||
      "unknown error";
    const summary = `${operation}: ${status ? `HTTP ${status} — ` : ""}${detail}`;
    this.errors.push(summary);
    logger.error(`[RealEstateApi] ${summary}`);
  }

  /** POST with a single retry on rate-limit (429) or transient 5xx errors. */
  private async post(url: string, body: Record<string, any>): Promise<any> {
    try {
      return await axios.post(url, body, { headers: this.headers(), timeout: 30000 });
    } catch (error) {
      const status = (error as AxiosError)?.response?.status;
      if (status !== 429 && !(status && status >= 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, status === 429 ? 3000 : 1000));
      return await axios.post(url, body, { headers: this.headers(), timeout: 30000 });
    }
  }

  /**
   * Flat filter object per RealEstateAPI docs, e.g.
   * { city: "Tampa", state: "FL", property_type: "MFR", absentee_owner: true }
   */
  async propertySearch(filters: Record<string, any>, size = 10): Promise<PropertySearchResult[]> {
    try {
      const response = await this.post(`${BASE_URL}/v2/PropertySearch`, { ...filters, size });
      const statusCode = response.data?.statusCode;
      if (statusCode && statusCode !== 200) {
        this.recordError(
          `PropertySearch(${filters.city || "?"}, ${filters.state || "?"})`,
          { message: response.data?.statusMessage || `statusCode ${statusCode}`, response: { status: statusCode, data: response.data } }
        );
        return [];
      }
      return (response.data?.data || []) as PropertySearchResult[];
    } catch (error: any) {
      this.recordError(`PropertySearch(${filters.city || "?"}, ${filters.state || "?"})`, error);
      return [];
    }
  }

  /**
   * Skip-trace an owner. For absentee owners, prefer the mailing address —
   * tracing the property address often returns prior residents/tenants
   * (verified: a Tampa absentee property returned "Yvonne Lazarus" ahead of
   * the real owner "Catherine Gay"). Falls back to the property address once.
   * Each attempt costs one credit; `attempts` reports how many were made.
   */
  async skipTraceOwner(params: {
    firstName?: string | null;
    lastName?: string | null;
    coOwnerLastName?: string | null;
    property: { street: string; city: string; state: string; zip: string };
    mail?: { street?: string; city?: string; state?: string; zip?: string } | null;
    preferMail?: boolean;
    maxAttempts?: number;
  }): Promise<{ result: SkipTraceResult | null; attempts: number }> {
    const attempts: Array<{
      via: "property" | "mail";
      street: string;
      city: string;
      state: string;
      zip: string;
    }> = [];

    const mail = params.mail;
    const mailStreet = RealEstateApiService.resolveMailStreet(mail);
    const mailUsable =
      Boolean(mailStreet && mail?.city && mail?.state && mail?.zip) &&
      this.normalizeAddressKey(mailStreet!, mail!.city!, mail!.state!, mail!.zip!) !==
        this.normalizeAddressKey(
          params.property.street,
          params.property.city,
          params.property.state,
          params.property.zip
        );

    if (params.preferMail && mailUsable) {
      attempts.push({
        via: "mail",
        street: mailStreet!,
        city: mail!.city!,
        state: mail!.state!,
        zip: mail!.zip!,
      });
    }
    attempts.push({ via: "property", ...params.property });
    if (!params.preferMail && mailUsable) {
      attempts.push({
        via: "mail",
        street: mailStreet!,
        city: mail!.city!,
        state: mail!.state!,
        zip: mail!.zip!,
      });
    }

    const maxAttempts = Math.max(1, params.maxAttempts ?? attempts.length);
    let used = 0;
    for (const attempt of attempts.slice(0, maxAttempts)) {
      used += 1;
      const result = await this.skipTraceOnce({
        firstName: params.firstName,
        lastName: params.lastName,
        coOwnerLastName: params.coOwnerLastName,
        address: attempt.street,
        city: attempt.city,
        state: attempt.state,
        zip: attempt.zip,
      });
      if (result && (result.phones.length || result.emails.length)) {
        return { result: { ...result, matchedVia: attempt.via }, attempts: used };
      }
    }
    return { result: null, attempts: used };
  }

  private normalizeAddressKey(street: string, city: string, state: string, zip: string): string {
    return `${street}|${city}|${state}|${zip}`.toLowerCase().replace(/[^a-z0-9|]/g, "");
  }

  /** RealEstateAPI often returns the literal string "None" instead of null. */
  static cleanName(value: string | null | undefined): string | null {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed || /^none$/i.test(trimmed) || /^null$/i.test(trimmed) || /^n\/?a$/i.test(trimmed)) {
      return null;
    }
    return trimmed;
  }

  /**
   * Prefer mail.street; if missing, peel the street off mail.address
   * ("6910 N Willow Ave, Tampa, FL 33604" → "6910 N Willow Ave").
   */
  static resolveMailStreet(mail?: {
    street?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null): string | null {
    if (!mail) return null;
    const street = RealEstateApiService.cleanName(mail.street);
    if (street) return street;
    const full = RealEstateApiService.cleanName(mail.address);
    if (!full) return null;
    // Take everything before the first comma as the street line.
    const beforeComma = full.split(",")[0]?.trim();
    return beforeComma || null;
  }

  private async skipTraceOnce(params: {
    firstName?: string | null;
    lastName?: string | null;
    coOwnerLastName?: string | null;
    address: string;
    city: string;
    state: string;
    zip: string;
  }): Promise<Omit<SkipTraceResult, "matchedVia"> | null> {
    try {
      const firstName = RealEstateApiService.cleanName(params.firstName);
      const lastName = RealEstateApiService.cleanName(params.lastName);
      const coOwnerLastName = RealEstateApiService.cleanName(params.coOwnerLastName);

      const body: Record<string, string> = {
        address: params.address,
        city: params.city,
        state: params.state,
        zip: params.zip,
      };
      if (firstName) body.first_name = firstName;
      if (lastName) body.last_name = lastName;

      const response = await this.post(`${BASE_URL}/v1/SkipTrace`, body);

      // RealEstateAPI returns HTTP 200 with responseCode != 0 on soft failures.
      if (response.data?.responseCode != null && Number(response.data.responseCode) !== 0) {
        this.recordError(
          `SkipTrace(${params.address})`,
          { message: response.data?.responseMessage || `responseCode ${response.data.responseCode}` }
        );
        return null;
      }

      const identity = response.data?.output?.identity;
      if (!identity) return null;

      // Never fall back to "any person" — prior residents pollute this payload.
      // Match by last name, then prefer the person whose first name matches the
      // county-record owner (avoids returning the spouse when both share a surname).
      const persons: any[] = identity.names || [];
      const normalizeName = (value: any) => String(value || "").toLowerCase().replace(/[^a-z]/g, "");
      const findOwner = (wantedLast?: string | null, wantedFirst?: string | null) => {
        const last = normalizeName(wantedLast);
        if (!last || last.length < 2) return undefined;
        const lastMatches = persons.filter((p) => {
          const have = normalizeName(p.lastName);
          return have && (have.includes(last) || last.includes(have));
        });
        if (!lastMatches.length) return undefined;
        const first = normalizeName(wantedFirst);
        if (first && first.length >= 2) {
          const byFirst = lastMatches.find((p) => {
            const have = normalizeName(p.firstName);
            return have && (have.includes(first) || first.includes(have));
          });
          if (byFirst) return byFirst;
        }
        return lastMatches[0];
      };

      const target = lastName ? findOwner(lastName, firstName) : persons[0];
      if (lastName && !target && !coOwnerLastName) return null;

      const coOwner =
        coOwnerLastName && normalizeName(coOwnerLastName) !== normalizeName(lastName)
          ? findOwner(coOwnerLastName, null)
          : undefined;

      const normalizePhones = (raw: any[]): SkipTracePhone[] =>
        raw
          .filter((p: any) => p.isConnected !== false && p.phone)
          .map((p: any) => ({
            phone: String(p.phone).replace(/\D/g, ""),
            phoneDisplay: p.phoneDisplay || p.phone,
            phoneType: p.phoneType || "unknown",
            isConnected: p.isConnected !== false,
            doNotCall: Boolean(p.doNotCall),
          }))
          .filter((p) => p.phone.length >= 10)
          // Callable first: non-DNC beats DNC, then mobile beats landline.
          .sort((a, b) => {
            const dncDiff = Number(a.doNotCall) - Number(b.doNotCall);
            if (dncDiff !== 0) return dncDiff;
            return Number(b.phoneType === "mobile") - Number(a.phoneType === "mobile");
          });

      const allPhones: any[] = identity.phones || [];
      const allEmails: any[] = identity.emails || [];
      let matchedPerson = target;
      // personId can be empty string for some matches — treat that as "unlinked".
      const targetId = target?.personId ? String(target.personId) : "";
      let phones = target
        ? normalizePhones(
            targetId
              ? allPhones.filter((p: any) => String(p.personId || "") === targetId)
              : []
          )
        : [];

      // If the primary owner matched but has no linked phones (empty personId is
      // common), fall back to the co-owner/spouse rather than returning a miss
      // when a household number is available.
      if (!phones.length && coOwner?.personId) {
        const coOwnerId = String(coOwner.personId);
        const coOwnerPhones = normalizePhones(
          allPhones.filter((p: any) => String(p.personId || "") === coOwnerId)
        );
        if (coOwnerPhones.length) {
          matchedPerson = coOwner;
          phones = coOwnerPhones;
        }
      }

      if (!matchedPerson) return null;

      const matchedId = matchedPerson.personId ? String(matchedPerson.personId) : "";
      const emails: string[] = allEmails
        .filter((e: any) => (!matchedId || String(e.personId || "") === matchedId) && e.email)
        .map((e: any) => String(e.email).trim().toLowerCase())
        .filter((e, i, arr) => arr.indexOf(e) === i);

      // Primary matched with empty personId and no co-owner phones — still return
      // the name so the suppression/no_contact path can record the miss, but only
      // attach phones that are explicitly linked (already handled above).
      return {
        fullName: matchedPerson.fullName || null,
        phones,
        emails,
      };
    } catch (error: any) {
      this.recordError(`SkipTrace(${params.address})`, error);
      return null;
    }
  }
}
