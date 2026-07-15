import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import sendSlackMessage from "../utils/sendSlackMsg";
import { SalesLeadEntity, SalesLeadCategory } from "../entity/SalesLead";
import {
  RealEstateApiService,
  PropertySearchResult,
  SkipTraceResult,
} from "./RealEstateApiService";

interface Market {
  city: string;
  state: string;
}

interface LeadCandidate {
  category: SalesLeadCategory;
  market: string;
  property: PropertySearchResult;
  hook: string;
  pitch: string;
  score: number;
  /** Entity-owned (LLC/trust/corp) — skip tracing can't reach these; mail/registry only. */
  isCompany?: boolean;
}

// Strict entity markers. Prefer corporateOwned from the API; this catches
// "Samson Holdings Llc" / "Infante Junior Construction" when the corp flag
// is missing. Avoids false positives on people named Homes / Estates / Group.
const COMPANY_NAME_PATTERN =
  /\b(llc|l\.?\s*l\.?\s*c\.?|inc\.?|corp\.?|corporation|ltd\.?|l\.?\s*p\.?|llp|company|holdings|investments|construction|builders|management|apartments|housing|properties)\b/i;

const isLikelyCompany = (name: string | null | undefined): boolean =>
  Boolean(name && COMPANY_NAME_PATTERN.test(name));

/** "Colt 2022 5 Trust" / "None Citibank Na" — trust entities with no human first name. */
const isTrustEntity = (firstName: string | null, lastName: string | null): boolean => {
  const full = `${firstName || ""} ${lastName || ""}`.trim();
  if (!/\btrust\b/i.test(full)) return false;
  if (!firstName) return true;
  if (/\d/.test(full)) return true;
  if (/\b(living|revocable|irrevocable|family|testamentary)\b/i.test(full)) return true;
  return false;
};

const escapeSlackMrkdwn = (value: string | null | undefined): string =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const LOCK_NAME = "daily_sales_report";

const STATE_ABBREV: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};

const DEDUPE_WINDOW_DAYS = 90;
const DEFAULT_LEADS_PER_SECTION = 5;
const SLACK_MAX_BLOCKS = 48; // Slack hard-caps at 50; leave room for footer.
const COMPANY_LEADS_RESERVED = 1; // Keep at least one slot for a dial-free entity whale when people fill up.

const SECTION_META: Record<SalesLeadCategory, { title: string; emoji: string }> = {
  arbitrage: { title: "Arbitrage — Landlord Whales", emoji: ":fishing_pole_and_fish:" },
  acquisition: { title: "Acquisition — Motivated Sellers", emoji: ":house_with_garden:" },
  property_management: { title: "PM Prospects — New Absentee Buyers", emoji: ":key:" },
  internal_upsell: { title: "Internal — Upsell Candidates", emoji: ":chart_with_upwards_trend:" },
};

/** Prevents overlapping runs from double-spending skip-trace credits.
 *  In-memory flag covers same-process reentry; MariaDB GET_LOCK covers the
 *  PM2 cluster (4 API instances) + concurrent cron/manual triggers. */
let reportRunning = false;

export class DailySalesReportService {
  private readonly leadRepo = appDatabase.getRepository(SalesLeadEntity);
  private readonly realEstateApi = new RealEstateApiService();
  private schemaEnsured = false;
  private ownAddressKeys: Set<string> | null = null;

  private async ensureSchema() {
    if (this.schemaEnsured) return;
    await appDatabase.query(`
      CREATE TABLE IF NOT EXISTS sales_leads (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        reportDate DATE NOT NULL,
        category VARCHAR(40) NOT NULL,
        market VARCHAR(120) NULL,
        ownerName VARCHAR(255) NULL,
        phone VARCHAR(40) NULL,
        phoneType VARCHAR(20) NULL,
        phoneDnc TINYINT(1) NOT NULL DEFAULT 0,
        email VARCHAR(255) NULL,
        propertyAddress VARCHAR(255) NULL,
        city VARCHAR(120) NULL,
        state VARCHAR(40) NULL,
        zip VARCHAR(20) NULL,
        hook TEXT NULL,
        pitch TEXT NULL,
        score FLOAT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        source VARCHAR(60) NULL,
        externalPropertyId VARCHAR(60) NULL,
        dedupeKey VARCHAR(191) NOT NULL,
        rawData LONGTEXT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_sales_leads_dedupe (dedupeKey),
        KEY idx_sales_leads_report_date (reportDate),
        KEY idx_sales_leads_category (category),
        KEY idx_sales_leads_status (status)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // Self-heal from the original schema, where dedupeKey was UNIQUE.
    const uniqueIdx: Array<{ Key_name: string }> = await appDatabase.query(
      `SHOW INDEX FROM sales_leads WHERE Key_name = 'uq_sales_leads_dedupe' AND Non_unique = 0`
    );
    if (uniqueIdx.length) {
      await appDatabase.query(`ALTER TABLE sales_leads DROP INDEX uq_sales_leads_dedupe`);
      const plainIdx: Array<{ Key_name: string }> = await appDatabase.query(
        `SHOW INDEX FROM sales_leads WHERE Key_name = 'idx_sales_leads_dedupe'`
      );
      if (!plainIdx.length) {
        await appDatabase.query(`ALTER TABLE sales_leads ADD KEY idx_sales_leads_dedupe (dedupeKey)`);
      }
      logger.info("[DailySalesReport] Migrated sales_leads dedupeKey from UNIQUE to plain index.");
    }

    this.schemaEnsured = true;
  }

  // ---------- markets ----------

  private normalizeState(state: string): string {
    const trimmed = state.trim();
    if (trimmed.length === 2) return trimmed.toUpperCase();
    return STATE_ABBREV[trimmed.toLowerCase()] || trimmed.toUpperCase();
  }

  private async getTargetMarkets(): Promise<Market[]> {
    const override = String(process.env.SALES_REPORT_MARKETS || "").trim();
    if (override) {
      return override
        .split(";")
        .map((pair) => {
          const [city, state] = pair.split(",").map((s) => s.trim());
          return city && state ? { city, state: this.normalizeState(state) } : null;
        })
        .filter(Boolean) as Market[];
    }

    const rows: Array<{ city: string; state: string; c: number }> = await appDatabase.query(`
      SELECT city, state, COUNT(*) AS c
      FROM listing_info
      WHERE deletedAt IS NULL AND city IS NOT NULL AND city != '' AND state IS NOT NULL AND state != ''
      GROUP BY city, state
      HAVING c >= 3
      ORDER BY c DESC
      LIMIT 3
    `);
    return rows.map((r) => ({ city: r.city, state: this.normalizeState(r.state) }));
  }

  // ---------- own portfolio exclusion ----------

  private addressKey(address: string): string {
    return address.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  private async loadOwnAddressKeys(): Promise<Set<string>> {
    if (this.ownAddressKeys) return this.ownAddressKeys;
    try {
      const rows: Array<{ address: string; street: string }> = await appDatabase.query(`
        SELECT address, street FROM listing_info WHERE deletedAt IS NULL
      `);
      this.ownAddressKeys = new Set(
        rows
          .flatMap((r) => [r.address, r.street].filter(Boolean))
          .map((a) => this.addressKey(String(a)))
          .filter((k) => k.length >= 8)
      );
    } catch (error) {
      logger.error("[DailySalesReport] Failed loading own portfolio addresses:", error);
      this.ownAddressKeys = new Set();
    }
    return this.ownAddressKeys;
  }

  private async isOwnProperty(p: PropertySearchResult): Promise<boolean> {
    const keys = await this.loadOwnAddressKeys();
    const candidates = [p.address?.address, p.address?.street].filter(Boolean) as string[];
    return candidates.some((c) => keys.has(this.addressKey(c)));
  }

  // ---------- dedupe ----------

  private dedupeKey(category: SalesLeadCategory, address: string): string {
    const normalized = this.addressKey(address);
    return `${category}:${normalized}`.slice(0, 191);
  }

  private async filterNewCandidates(candidates: LeadCandidate[]): Promise<LeadCandidate[]> {
    if (!candidates.length) return [];

    // Drop anything already in our managed portfolio, or with no usable address.
    const withoutOwn: LeadCandidate[] = [];
    for (const c of candidates) {
      const addr = c.property?.address?.address;
      if (!addr || this.addressKey(addr).length < 8) continue;
      if (await this.isOwnProperty(c.property)) continue;
      withoutOwn.push(c);
    }
    if (!withoutOwn.length) return [];

    const keys = withoutOwn.map((c) => this.dedupeKey(c.category, c.property.address.address));
    // Soft suppress: anything seen in the last 90 days.
    // Hard suppress: dead/won never come back (sales already disposed of them).
    const existing: Array<{ dedupeKey: string; status: string }> = await appDatabase.query(
      `SELECT dedupeKey, status FROM sales_leads
       WHERE dedupeKey IN (${keys.map(() => "?").join(",")})
         AND (
           createdAt > DATE_SUB(NOW(), INTERVAL ${DEDUPE_WINDOW_DAYS} DAY)
           OR status IN ('dead', 'won')
         )`,
      keys
    );
    const taken = new Set(existing.map((e) => e.dedupeKey));

    return withoutOwn.filter((c) => {
      const key = this.dedupeKey(c.category, c.property.address.address);
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    });
  }

  // ---------- candidate discovery ----------

  private formatMoney(value: number | string | null | undefined): string {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "n/a";
    return `$${Math.round(n).toLocaleString("en-US")}`;
  }

  private isCompanyOwned(p: PropertySearchResult): boolean {
    const first = RealEstateApiService.cleanName(p.owner1FirstName);
    const last = RealEstateApiService.cleanName(p.owner1LastName);
    const ownerName = [first, last].filter(Boolean).join(" ");
    if (p.corporateOwned) return true;
    if (isTrustEntity(first, last)) return true;
    if (isLikelyCompany(ownerName)) return true;
    if (!first && isLikelyCompany(last)) return true;
    return false;
  }

  private ownerDisplayName(p: PropertySearchResult): string {
    const first = RealEstateApiService.cleanName(p.owner1FirstName);
    const last = RealEstateApiService.cleanName(p.owner1LastName);
    return [first, last].filter(Boolean).join(" ") || "Unknown owner";
  }

  private async findArbitrageWhales(market: Market): Promise<LeadCandidate[]> {
    // 2–4 unit small multifamily, absentee, owned 8+ yrs — the master-lease
    // sweet spot. Prefer individuals (dialable); pull a smaller corp set for mail.
    const [people, entities] = await Promise.all([
      this.realEstateApi.propertySearch(
        {
          city: market.city,
          state: market.state,
          property_type: "MFR",
          absentee_owner: true,
          years_owned_min: 8,
          units_min: 2,
          units_max: 4,
          individual_owned: true,
        },
        20
      ),
      this.realEstateApi.propertySearch(
        {
          city: market.city,
          state: market.state,
          property_type: "MFR",
          absentee_owner: true,
          years_owned_min: 8,
          units_min: 5,
          units_max: 40,
          corporate_owned: true,
        },
        8
      ),
    ]);

    const mapCandidate = (p: PropertySearchResult): LeadCandidate => {
      const rent = Number(p.suggestedRent) || 0;
      const units = p.unitsCount || 2;
      const rentNote = rent > 0 ? ` Market rent ~${this.formatMoney(rent)}/mo.` : "";
      return {
        category: "arbitrage",
        market: `${market.city}, ${market.state}`,
        property: p,
        isCompany: this.isCompanyOwned(p),
        hook: `${units}-unit MFR owned ${p.yearsOwned ?? "?"} yrs, absentee. Est. value ${this.formatMoney(p.estimatedValue)}, equity ${p.equityPercent ?? "?"}%.${rentNote}`,
        pitch:
          'Opener: "We lease your units long-term at full market rent, guaranteed on the 1st, and handle every guest and repair call. You keep the income, lose the headaches."',
        // Cap unit weight so a 40-unit corp doesn't bury every 2-unit individual.
        score: (p.yearsOwned || 0) + Math.min(units, 8) * 2 + (p.equityPercent || 0) / 20,
      };
    };

    return [...people, ...entities]
      .map(mapCandidate)
      .sort((a, b) => {
        // People first, then score — sales can dial today.
        if (Boolean(a.isCompany) !== Boolean(b.isCompany)) return a.isCompany ? 1 : -1;
        return b.score - a.score;
      });
  }

  private async findMotivatedSellers(market: Market): Promise<LeadCandidate[]> {
    const [preForeclosure, priceCuts] = await Promise.all([
      this.realEstateApi.propertySearch(
        {
          city: market.city,
          state: market.state,
          pre_foreclosure: true,
          mls_active: true,
          beds_min: 3,
          individual_owned: true,
        },
        10
      ),
      this.realEstateApi.propertySearch(
        {
          city: market.city,
          state: market.state,
          mls_active: true,
          price_reduced: true,
          beds_min: 3,
          individual_owned: true,
        },
        10
      ),
    ]);

    const seen = new Set<string>();
    const combined = [...preForeclosure, ...priceCuts].filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      if (!p.mlsListingPrice || p.mlsListingPrice < 50000) return false;
      if ((p.mlsDaysOnMarket || 0) > 365) return false;
      if (p.estimatedValue && p.mlsListingPrice < p.estimatedValue * 0.2) return false;
      return true;
    });

    return combined
      .map((p) => {
        const rawDiscount =
          p.mlsListingPrice && p.estimatedValue
            ? Math.round((1 - p.mlsListingPrice / p.estimatedValue) * 100)
            : null;
        const discount = rawDiscount && rawDiscount >= 5 ? rawDiscount : null;
        const flags = [
          p.preForeclosure ? "PRE-FORECLOSURE" : null,
          p.priceReduced ? "price cut" : null,
          p.mlsDaysOnMarket ? `${p.mlsDaysOnMarket} DOM` : null,
        ]
          .filter(Boolean)
          .join(", ");
        return {
          category: "acquisition" as SalesLeadCategory,
          market: `${market.city}, ${market.state}`,
          property: p,
          isCompany: this.isCompanyOwned(p),
          hook: `${p.bedrooms || "?"}BR listed at ${this.formatMoney(p.mlsListingPrice)} (est. value ${this.formatMoney(p.estimatedValue)}${discount ? `, ~${discount}% under` : ""}) — ${flags}.`,
          pitch:
            'Opener: "We buy as-is with a fast close, no showings and no repairs. Can I send you a cash number this week?"',
          score:
            Math.max(rawDiscount || 0, 0) +
            (p.preForeclosure ? 25 : 0) +
            Math.min((p.mlsDaysOnMarket || 0) / 10, 15),
        };
      })
      .sort((a, b) => {
        if (Boolean(a.isCompany) !== Boolean(b.isCompany)) return a.isCompany ? 1 : -1;
        return b.score - a.score;
      });
  }

  private async findPmProspects(market: Market): Promise<LeadCandidate[]> {
    // Prefer individuals — 80%+ of "out of state recent buyer" hits are LLCs
    // that burn skip-trace budget for nothing.
    const [people, entities] = await Promise.all([
      this.realEstateApi.propertySearch(
        {
          city: market.city,
          state: market.state,
          property_type: "SFR",
          beds_min: 3,
          out_of_state_owner: true,
          years_owned_max: 1,
          individual_owned: true,
        },
        20
      ),
      this.realEstateApi.propertySearch(
        {
          city: market.city,
          state: market.state,
          property_type: "SFR",
          beds_min: 3,
          out_of_state_owner: true,
          years_owned_max: 1,
          corporate_owned: true,
        },
        5
      ),
    ]);

    const mapCandidate = (p: PropertySearchResult): LeadCandidate => {
      const mailState = p.mailAddress?.state || "out of state";
      const rent = Number(p.suggestedRent) || 0;
      const rentNote =
        rent > 0 ? ` Market rent ~${this.formatMoney(rent)}/mo; STR potential likely higher.` : "";
      return {
        category: "property_management",
        market: `${market.city}, ${market.state}`,
        property: p,
        isCompany: this.isCompanyOwned(p),
        hook: `Bought ${p.bedrooms || "?"}BR for ${this.formatMoney(p.lastSaleAmount)} on ${p.lastSaleDate || "?"}, owner lives in ${mailState}.${rentNote}`,
        pitch:
          'Opener: "Congrats on the new place — we manage short-term rentals in the area and our owners net more than a long-term lease without lifting a finger. Want the numbers for your address?"',
        score:
          (p.bedrooms || 0) * 5 +
          (Number(p.lastSaleAmount) > 300000 ? 10 : 0) +
          (p.outOfStateAbsenteeOwner ? 10 : 0),
      };
    };

    return [...people, ...entities]
      .map(mapCandidate)
      .sort((a, b) => {
        if (Boolean(a.isCompany) !== Boolean(b.isCompany)) return a.isCompany ? 1 : -1;
        return b.score - a.score;
      });
  }

  // ---------- internal upsell ----------

  private async findInternalUpsells(): Promise<
    Array<{ listingName: string; ownerName: string | null; ownerPhone: string | null; hook: string }>
  > {
    try {
      const rows: Array<{
        name: string;
        ownerName: string | null;
        ownerPhone: string | null;
        tags: string;
        revenue30: number;
        nights30: number;
      }> = await appDatabase.query(`
        SELECT li.name, li.ownerName, li.ownerPhone, li.tags,
               COALESCE(SUM(ri.payoutPrice), 0) AS revenue30,
               COALESCE(SUM(ri.nights), 0) AS nights30
        FROM listing_info li
        LEFT JOIN reservation_info ri
          ON ri.listingMapId = li.id
          AND ri.arrivalDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          AND ri.status IN ('new', 'modified', 'accepted', 'ownerStay', 'moved')
        WHERE li.deletedAt IS NULL
          AND li.tags LIKE '%Launch%'
          AND li.tags NOT LIKE '%Pro%'
          AND li.tags NOT LIKE '%Full%'
        GROUP BY li.id, li.name, li.ownerName, li.ownerPhone, li.tags
        HAVING revenue30 > 0
        ORDER BY revenue30 DESC
        LIMIT 5
      `);

      return rows.map((r) => ({
        listingName: r.name,
        ownerName: r.ownerName,
        ownerPhone: r.ownerPhone,
        hook: `Launch-tier listing grossed ${this.formatMoney(r.revenue30)} / ${r.nights30} nights in the last 30 days — performing well enough to pitch Pro/Full ("more income, less work").`,
      }));
    } catch (error) {
      logger.error("[DailySalesReport] Internal upsell query failed:", error);
      return [];
    }
  }

  // ---------- skip tracing ----------

  private todayEt(): string {
    // America/New_York calendar date regardless of server timezone.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  private formatHeaderDateEt(): string {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date());
  }

  private async enrichWithContacts(
    candidates: LeadCandidate[],
    budget: { remaining: number },
    leadsTarget: number,
    seenContacts: { phones: Set<string>; propertyIds: Set<string> }
  ): Promise<{ leads: SalesLeadEntity[]; skipTracesUsed: number }> {
    const personOwned = candidates.filter((c) => !c.isCompany);
    const companyOwned = candidates.filter((c) => c.isCompany);

    const leads: SalesLeadEntity[] = [];
    const today = this.todayEt();
    let skipTracesUsed = 0;

    // Reserve one slot for an entity whale when people would otherwise fill the section.
    const peopleTarget = Math.max(1, leadsTarget - COMPANY_LEADS_RESERVED);

    for (const candidate of personOwned) {
      if (leads.length >= peopleTarget) break;
      if (budget.remaining <= 0) break;

      const p = candidate.property;
      if (p.id && seenContacts.propertyIds.has(p.id)) continue;

      const lastName = RealEstateApiService.cleanName(p.owner1LastName);
      const firstName = RealEstateApiService.cleanName(p.owner1FirstName);
      if (!lastName) {
        // Can't safely match a skip-trace person without a last name — don't burn a credit.
        continue;
      }

      budget.remaining -= 1;
      const preferMail = Boolean(p.absenteeOwner || p.outOfStateAbsenteeOwner || !p.ownerOccupied);
      // Allow a second attempt (mail→property or property→mail) only when budget remains.
      const maxAttempts = budget.remaining >= 1 ? 2 : 1;

      const { result: trace, attempts } = await this.realEstateApi.skipTraceOwner({
        firstName,
        lastName,
        coOwnerLastName: RealEstateApiService.cleanName(p.owner2LastName),
        property: {
          street: p.address.street,
          city: p.address.city,
          state: p.address.state,
          zip: p.address.zip,
        },
        mail: p.mailAddress,
        preferMail,
        maxAttempts,
      });

      // First attempt already deducted; charge extras.
      if (attempts > 1) {
        budget.remaining = Math.max(0, budget.remaining - (attempts - 1));
      }
      skipTracesUsed += attempts;

      // Prefer a phone we haven't already handed the team today (same owner,
      // multiple properties → one call sheet entry).
      const bestPhone =
        trace?.phones?.find((ph) => !seenContacts.phones.has(ph.phone)) ||
        trace?.phones?.[0] ||
        null;
      const bestEmail = trace?.emails?.[0] || null;
      const hasContact = Boolean(bestPhone || bestEmail);

      // If the only phone is a duplicate of an earlier lead, still save a
      // suppression record but don't surface it as a fresh dial.
      const phoneAlreadySeen = Boolean(
        bestPhone && seenContacts.phones.has(bestPhone.phone) && !bestEmail
      );
      const surfaceAsLead = hasContact && !phoneAlreadySeen;

      const ownerName = trace?.fullName || this.ownerDisplayName(p);

      const lead = this.leadRepo.create({
        reportDate: today,
        category: candidate.category,
        market: candidate.market,
        ownerName,
        phone: bestPhone?.phoneDisplay || null,
        phoneType: bestPhone?.phoneType || null,
        phoneDnc: Boolean(bestPhone?.doNotCall),
        email: bestEmail,
        propertyAddress: p.address.address,
        city: p.address.city,
        state: p.address.state,
        zip: p.address.zip,
        hook: candidate.hook,
        pitch: candidate.pitch,
        score: candidate.score,
        status: surfaceAsLead ? "new" : "no_contact",
        source: "realestateapi",
        externalPropertyId: p.id,
        dedupeKey: this.dedupeKey(candidate.category, p.address.address),
        rawData: JSON.stringify({ property: p, skipTrace: trace }),
      });

      try {
        const saved = await this.leadRepo.save(lead);
        if (p.id) seenContacts.propertyIds.add(p.id);
        if (bestPhone?.phone) seenContacts.phones.add(bestPhone.phone);
        if (surfaceAsLead) leads.push(saved);
      } catch (error) {
        logger.error("[DailySalesReport] Failed saving lead:", error);
      }
    }

    const companySlots = Math.min(
      2,
      Math.max(COMPANY_LEADS_RESERVED, leadsTarget - leads.length)
    );
    let companiesAdded = 0;
    for (const candidate of companyOwned) {
      if (leads.length >= leadsTarget) break;
      if (companiesAdded >= companySlots) break;

      const p = candidate.property;
      if (p.id && seenContacts.propertyIds.has(p.id)) continue;

      // Only surface entity leads we can actually reach by mail.
      const mailAddress = p.mailAddress?.address
        ? `${p.mailAddress.address}${
            p.mailAddress.city
              ? `, ${p.mailAddress.city}, ${p.mailAddress.state} ${p.mailAddress.zip || ""}`
              : ""
          }`.trim()
        : null;
      if (!mailAddress) continue;

      const ownerName = this.ownerDisplayName(p);

      const lead = this.leadRepo.create({
        reportDate: today,
        category: candidate.category,
        market: candidate.market,
        ownerName,
        phone: null,
        phoneType: null,
        phoneDnc: false,
        email: null,
        propertyAddress: p.address.address,
        city: p.address.city,
        state: p.address.state,
        zip: p.address.zip,
        hook: `${candidate.hook} Entity owner — mail to ${mailAddress}, or pull the registered agent from the state business registry.`,
        pitch: candidate.pitch,
        score: candidate.score,
        status: "new",
        source: "realestateapi",
        externalPropertyId: p.id,
        dedupeKey: this.dedupeKey(candidate.category, p.address.address),
        rawData: JSON.stringify({ property: p }),
      });

      try {
        const saved = await this.leadRepo.save(lead);
        if (p.id) seenContacts.propertyIds.add(p.id);
        leads.push(saved);
        companiesAdded += 1;
      } catch (error) {
        logger.error("[DailySalesReport] Failed saving company lead:", error);
      }
    }

    return { leads, skipTracesUsed };
  }

  // ---------- Slack formatting ----------

  private formatLeadLine(lead: SalesLeadEntity, index: number): string {
    const dncWarning = lead.phoneDnc
      ? " :no_entry_sign: *DNC — do not cold call, text/mail only*"
      : "";
    const email = lead.email ? ` | ${escapeSlackMrkdwn(lead.email)}` : "";
    const contact = lead.phone
      ? `\`${lead.phone}\` (${lead.phoneType})`
      : lead.email
        ? "_email only_"
        : "_mail / registry lookup_";
    // Slack section text max is 3000 chars — keep each lead compact.
    const hook = escapeSlackMrkdwn(lead.hook || "").slice(0, 500);
    const pitch = escapeSlackMrkdwn(lead.pitch || "").slice(0, 300);
    return [
      `*${index + 1}. ${escapeSlackMrkdwn(lead.ownerName)}* — ${contact}${dncWarning}${email}`,
      `${escapeSlackMrkdwn(lead.propertyAddress)}`,
      hook,
      `_${pitch}_`,
    ].join("\n");
  }

  private buildSlackBlocks(
    leadsByCategory: Map<SalesLeadCategory, SalesLeadEntity[]>,
    upsells: Array<{
      listingName: string;
      ownerName: string | null;
      ownerPhone: string | null;
      hook: string;
    }>,
    markets: Market[],
    apiErrors: string[]
  ): any[] {
    const blocks: any[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Daily Growth Leads — ${this.formatHeaderDateEt()}`,
          emoji: true,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Markets: ${markets.map((m) => `${m.city}, ${m.state}`).join(" · ")} | Source: county records + skip trace (RealEstateAPI)`,
          },
        ],
      },
    ];

    // Prefer a dialable whale across sections (arbitrage first — biggest fish).
    const whale = Array.from(leadsByCategory.entries())
      .map(([, leads]) => {
        if (!leads.length) return null;
        const dialable = [...leads]
          .filter((l) => l.phone && !l.phoneDnc)
          .sort((a, b) => (b.score || 0) - (a.score || 0))[0];
        const top = [...leads].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
        return dialable || top;
      })
      .find(Boolean);

    if (whale) {
      blocks.push(
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:whale: *WHALE OF THE DAY*\n${this.formatLeadLine(whale, 0).replace(/^\*1\. /, "*")}`,
          },
        }
      );
    }

    for (const [category, leads] of leadsByCategory.entries()) {
      if (blocks.length >= SLACK_MAX_BLOCKS - 6) break;
      // Don't repeat the whale inside its section — already featured above.
      const sectionLeads = whale
        ? leads.filter((l) => l.id !== whale.id)
        : leads;
      const meta = SECTION_META[category];
      blocks.push(
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${meta.emoji} *${meta.title}* (${sectionLeads.length}${
              whale && leads.some((l) => l.id === whale.id) ? " + whale above" : ""
            })`,
          },
        }
      );
      if (!sectionLeads.length) {
        blocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: whale && leads.some((l) => l.id === whale.id)
                ? "_Whale of the day is the only lead in this section._"
                : "_No new leads today (dedupe window, no contact matches, or data source issue — see below)._",
            },
          ],
        });
        continue;
      }
      for (let i = 0; i < sectionLeads.length; i++) {
        if (blocks.length >= SLACK_MAX_BLOCKS - 4) break;
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: this.formatLeadLine(sectionLeads[i], i) },
        });
      }
    }

    const upsellMeta = SECTION_META.internal_upsell;
    if (blocks.length < SLACK_MAX_BLOCKS - 4) {
      blocks.push(
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${upsellMeta.emoji} *${upsellMeta.title}* (${upsells.length})`,
          },
        }
      );
      if (upsells.length) {
        upsells.forEach((u, i) => {
          if (blocks.length >= SLACK_MAX_BLOCKS - 2) return;
          const contact = [
            u.ownerName ? escapeSlackMrkdwn(u.ownerName) : null,
            u.ownerPhone ? `\`${u.ownerPhone}\`` : null,
          ]
            .filter(Boolean)
            .join(" — ");
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${i + 1}. ${escapeSlackMrkdwn(u.listingName)}*${contact ? ` — ${contact}` : ""}\n${escapeSlackMrkdwn(u.hook)}`,
            },
          });
        });
      } else {
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text: "_No upsell candidates found today._" }],
        });
      }
    }

    if (apiErrors.length && blocks.length < SLACK_MAX_BLOCKS - 2) {
      const unique = Array.from(new Set(apiErrors)).slice(0, 5);
      blocks.push(
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:rotating_light: *Data source problems this run:*\n${unique.map((e) => `• ${escapeSlackMrkdwn(e)}`).join("\n")}`,
          },
        }
      );
    }

    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: ":warning: Numbers marked DNC are on the federal Do-Not-Call registry — reach those by mail/text opt-in only. Leads repeat only after 90 days (dead/won never reappear).",
          },
        ],
      }
    );

    return blocks.slice(0, SLACK_MAX_BLOCKS);
  }

  // ---------- main entry point ----------

  private async acquireDbLock(): Promise<boolean> {
    try {
      // Stale lock safety: if a prior process crashed holding the lock, MariaDB
      // releases it when the connection dies. GET_LOCK is connection-scoped.
      const rows: Array<{ acquired: number }> = await appDatabase.query(
        `SELECT GET_LOCK(?, 0) AS acquired`,
        [LOCK_NAME]
      );
      return Number(rows?.[0]?.acquired) === 1;
    } catch (error) {
      logger.error("[DailySalesReport] Failed to acquire DB lock:", error);
      // Fail open on lock infrastructure errors so a DB glitch doesn't kill the report forever.
      return true;
    }
  }

  private async releaseDbLock(): Promise<void> {
    try {
      await appDatabase.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NAME]);
    } catch (error) {
      logger.error("[DailySalesReport] Failed to release DB lock:", error);
    }
  }

  async runDailyReport(): Promise<{
    leads: number;
    skipTracesUsed: number;
    markets: string[];
    slackPosted: boolean;
    skipped?: string;
  }> {
    if (reportRunning) {
      logger.warn("[DailySalesReport] Overlapping run skipped — previous report still in progress.");
      return {
        leads: 0,
        skipTracesUsed: 0,
        markets: [],
        slackPosted: false,
        skipped: "already_running",
      };
    }
    reportRunning = true;

    const dbLockHeld = await this.acquireDbLock();
    if (!dbLockHeld) {
      reportRunning = false;
      logger.warn(
        "[DailySalesReport] Overlapping run skipped — another process holds the MariaDB lock (PM2 cluster / concurrent trigger)."
      );
      return {
        leads: 0,
        skipTracesUsed: 0,
        markets: [],
        slackPosted: false,
        skipped: "already_running",
      };
    }

    try {
      await this.ensureSchema();

      const markets = await this.getTargetMarkets();
      if (!markets.length) {
        logger.warn("[DailySalesReport] No target markets found — set SALES_REPORT_MARKETS.");
        return { leads: 0, skipTracesUsed: 0, markets: [], slackPosted: false };
      }

      const maxSkipTraces = Number(process.env.SALES_REPORT_MAX_SKIP_TRACES || 15);
      const leadsPerSection = Number(
        process.env.SALES_REPORT_LEADS_PER_SECTION || DEFAULT_LEADS_PER_SECTION
      );
      let skipTracesUsed = 0;
      const leadsByCategory = new Map<SalesLeadCategory, SalesLeadEntity[]>();
      // Shared across sections so the same phone / property doesn't appear twice in one report.
      const seenContacts = { phones: new Set<string>(), propertyIds: new Set<string>() };

      if (RealEstateApiService.isConfigured()) {
        const sections: Array<{
          category: SalesLeadCategory;
          finder: (m: Market) => Promise<LeadCandidate[]>;
        }> = [
          { category: "arbitrage", finder: (m) => this.findArbitrageWhales(m) },
          { category: "acquisition", finder: (m) => this.findMotivatedSellers(m) },
          { category: "property_management", finder: (m) => this.findPmProspects(m) },
        ];

        const baseBudget = Math.floor(maxSkipTraces / sections.length);
        let carry = maxSkipTraces % sections.length;

        for (const section of sections) {
          let candidates: LeadCandidate[] = [];
          for (const market of markets) {
            candidates = candidates.concat(await section.finder(market));
          }
          candidates.sort((a, b) => {
            if (Boolean(a.isCompany) !== Boolean(b.isCompany)) return a.isCompany ? 1 : -1;
            return b.score - a.score;
          });
          const fresh = await this.filterNewCandidates(candidates);

          const sectionBudget = { remaining: baseBudget + carry };
          const { leads, skipTracesUsed: used } = await this.enrichWithContacts(
            fresh,
            sectionBudget,
            leadsPerSection,
            seenContacts
          );
          carry = sectionBudget.remaining;
          skipTracesUsed += used;

          leadsByCategory.set(section.category, leads);
          logger.info(
            `[DailySalesReport] ${section.category}: ${candidates.length} candidates, ${fresh.length} after dedupe, ${leads.length} leads, ${used} skip traces`
          );
        }
      } else {
        logger.warn("[DailySalesReport] REALESTATE_API_KEY not set — external sections skipped.");
        leadsByCategory.set("arbitrage", []);
        leadsByCategory.set("acquisition", []);
        leadsByCategory.set("property_management", []);
      }

      const upsells = await this.findInternalUpsells();

      const blocks = this.buildSlackBlocks(
        leadsByCategory,
        upsells,
        markets,
        this.realEstateApi.errors
      );
      const channel = process.env.SALES_REPORT_SLACK_CHANNEL || "#sales-leads";
      const totalLeads = Array.from(leadsByCategory.values()).flat().length;

      const slackResult = await sendSlackMessage({
        channel,
        text: `Daily Growth Leads — ${totalLeads} new leads with contact info`,
        blocks,
      });

      const slackPosted = Boolean(slackResult?.ok);
      if (!slackPosted) {
        logger.error(
          `[DailySalesReport] Slack post failed (channel=${channel}). Leads are saved — fetch via GET /sales/dailyLeadsReport/leads.`
        );
      }

      return {
        leads: totalLeads,
        skipTracesUsed,
        markets: markets.map((m) => `${m.city}, ${m.state}`),
        slackPosted,
      };
    } finally {
      await this.releaseDbLock();
      reportRunning = false;
    }
  }
}
