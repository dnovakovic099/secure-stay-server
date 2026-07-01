import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { Listing } from "../entity/Listing";
import { ListingKnowledgeEntryEntity } from "../entity/ListingKnowledgeEntry";
import { Hostify } from "../client/Hostify";

const SOURCE = "listing_import";

interface SeedEntry {
    title: string;
    category: string;
    visibility: "external" | "internal";
    content: string;
}

/**
 * Seeds each listing's Knowledge Base from the structured data we already hold in
 * `listing_info` (plus a defensive pull of amenities / house rules / area notes
 * from Hostify). This gives the bot authoritative, per-property grounding without
 * any AI guessing.
 *
 * STRICTLY per-listing: every entry is tied to one listingId. Sensitive values
 * (wifi password, exact street, owner, license) are stored as `internal` so the
 * bot can be informed by them but never quotes them to a guest.
 *
 * Idempotent: re-running updates the same rows (keyed by listingId + title +
 * source='listing_import') instead of duplicating.
 */
export class ListingKnowledgeSeeder {
    private listingRepo = appDatabase.getRepository(Listing);
    private kbRepo = appDatabase.getRepository(ListingKnowledgeEntryEntity);
    private hostify = new Hostify();

    private get apiKey(): string {
        return process.env.HOSTIFY_API_KEY as string;
    }

    /** Convert an hour-of-day int (0-23, or HHmm like 1500) to "3:00 PM". */
    private fmtHour(v: any): string | null {
        if (v == null || v === "") return null;
        let n = Number(v);
        if (!Number.isFinite(n)) return null;
        if (n > 23) n = Math.floor(n / 100); // handle 1500-style values
        if (n < 0 || n > 23) return null;
        const ampm = n >= 12 ? "PM" : "AM";
        const h12 = n % 12 === 0 ? 12 : n % 12;
        return `${h12}:00 ${ampm}`;
    }

    private clean(s: any): string {
        return String(s ?? "").replace(/\s+/g, " ").trim();
    }

    /**
     * Hostify/our DB use parenthesized placeholders like "(NOT SPECIFIED)",
     * "(NO WIFI)", "(NO PASSWORD)" for empty fields. Treat those (and common
     * "n/a"/"none") as blank so we never assert a false fact (e.g. "WiFi is
     * available") for a property that doesn't have it.
     */
    private isBlank(v: any): boolean {
        const s = this.clean(v).toLowerCase();
        if (!s) return true;
        if (/^\(.*\)$/.test(s)) return true; // (NO WIFI), (NOT SPECIFIED), ...
        return ["n/a", "na", "none", "null", "undefined", "not specified", "no wifi", "no password"].includes(s);
    }

    async seedAll(opts: { fetchHostify?: boolean; limit?: number } = {}): Promise<{ listings: number; entries: number }> {
        const fetchHostify = opts.fetchHostify !== false;
        const listings = await this.listingRepo.find({ take: opts.limit ?? 5000 });
        let listingCount = 0;
        let entryCount = 0;
        for (const l of listings) {
            try {
                const entries = await this.buildEntries(l, fetchHostify);
                for (const e of entries) {
                    if (await this.upsert(Number(l.id), e)) entryCount++;
                }
                await this.reconcile(Number(l.id), entries.map((e) => e.title));
                if (entries.length) listingCount++;
            } catch (err: any) {
                logger.warn(`[KBSeeder] listing ${l.id} failed: ${err.message}`);
            }
        }
        logger.info(`[KBSeeder] seeded ${entryCount} entries across ${listingCount} listings`);
        return { listings: listingCount, entries: entryCount };
    }

    async seedListing(listingId: number, fetchHostify = true): Promise<number> {
        const l = await this.listingRepo.findOne({ where: { id: listingId as any } });
        if (!l) return 0;
        const entries = await this.buildEntries(l, fetchHostify);
        let n = 0;
        for (const e of entries) if (await this.upsert(listingId, e)) n++;
        await this.reconcile(listingId, entries.map((e) => e.title));
        return n;
    }

    /** Archive any auto-imported entries that are no longer valid for this listing. */
    private async reconcile(listingId: number, desiredTitles: string[]) {
        const existing = await this.kbRepo.find({ where: { listingId: listingId as any, source: SOURCE, isArchived: 0 } });
        const keep = new Set(desiredTitles);
        const stale = existing.filter((e) => e.title && !keep.has(e.title));
        for (const s of stale) {
            s.isArchived = 1;
            await this.kbRepo.save(s);
        }
    }

    private async buildEntries(l: Listing, fetchHostify: boolean): Promise<SeedEntry[]> {
        const entries: SeedEntry[] = [];
        const push = (e: SeedEntry) => {
            if (e.content && e.content.trim()) entries.push(e);
        };

        // Property overview
        const overview: string[] = [];
        if (l.propertyType && l.propertyType !== "(NOT SPECIFIED)") overview.push(`Property type: ${l.propertyType}.`);
        if (l.bedroomsNumber != null) overview.push(`${l.bedroomsNumber} bedroom(s).`);
        if (l.bathroomsNumber != null) overview.push(`${l.bathroomsNumber} bathroom(s).`);
        const cap = l.personCapacity ?? l.guests;
        if (cap != null) overview.push(`Sleeps up to ${cap} guest(s).`);
        push({ title: "Property overview", category: "Overview", visibility: "external", content: overview.join(" ") });

        // Description (public listing copy)
        if (!this.isBlank(l.description))
            push({ title: "Listing description", category: "Overview", visibility: "external", content: this.clean(l.description).slice(0, 4000) });

        // Check-in / check-out
        const ci = this.fmtHour(l.checkInTimeStart);
        const ciEnd = this.fmtHour(l.checkInTimeEnd);
        const co = this.fmtHour(l.checkOutTime);
        const times: string[] = [];
        if (ci) times.push(`Check-in: from ${ci}${ciEnd ? ` to ${ciEnd}` : ""}.`);
        if (co) times.push(`Check-out: by ${co}.`);
        if (l.timeZoneName) times.push(`Local time zone: ${l.timeZoneName}.`);
        push({ title: "Check-in / check-out times", category: "Check-in", visibility: "external", content: times.join(" ") });

        // WiFi — availability external, credentials internal (only if real values)
        const hasWifiUser = !this.isBlank(l.wifiUsername);
        const hasWifiPass = !this.isBlank(l.wifiPassword);
        if (hasWifiUser || hasWifiPass) {
            push({ title: "WiFi availability", category: "Amenities", visibility: "external", content: "WiFi is available at this property. Network details are shared with confirmed guests before or at check-in." });
            const cred: string[] = [];
            if (hasWifiUser) cred.push(`Network: ${this.clean(l.wifiUsername)}`);
            if (hasWifiPass) cred.push(`Password: ${this.clean(l.wifiPassword)}`);
            push({ title: "WiFi credentials (staff only)", category: "Amenities", visibility: "internal", content: cred.join(" | ") });
        }

        // Fees
        const fees: string[] = [];
        if (l.cleaningFee != null && Number(l.cleaningFee) > 0) fees.push(`Cleaning fee: ${l.currencyCode || "USD"} ${l.cleaningFee}.`);
        if (l.airbnbPetFeeAmount != null && Number(l.airbnbPetFeeAmount) > 0) fees.push(`Pet fee: ${l.currencyCode || "USD"} ${l.airbnbPetFeeAmount}.`);
        if (l.priceForExtraPerson != null && Number(l.priceForExtraPerson) > 0)
            fees.push(`Extra guest fee: ${l.currencyCode || "USD"} ${l.priceForExtraPerson}/person beyond ${l.guestsIncluded ?? 1} included.`);
        push({ title: "Fees", category: "Pricing", visibility: "external", content: fees.join(" ") });

        // Stay length
        const stay: string[] = [];
        if (l.minNights != null) stay.push(`Minimum stay: ${l.minNights} night(s).`);
        if (l.maxNights != null && Number(l.maxNights) > 0) stay.push(`Maximum stay: ${l.maxNights} night(s).`);
        if (l.instantBookable) stay.push(`Instant booking: ${String(l.instantBookable) === "1" || l.instantBookable === "true" ? "enabled" : "not enabled"}.`);
        push({ title: "Stay length & booking", category: "Booking", visibility: "external", content: stay.join(" ") });

        // Location — city/state external, exact street internal
        const loc: string[] = [];
        if (l.city) loc.push(l.city);
        if (l.state) loc.push(l.state);
        if (l.country) loc.push(l.country);
        push({ title: "General location", category: "Location", visibility: "external", content: loc.length ? `Located in ${loc.join(", ")}.` : "" });
        const addr = !this.isBlank(l.address) ? l.address : !this.isBlank(l.street) ? l.street : "";
        push({ title: "Full address (staff only)", category: "Location", visibility: "internal", content: this.clean(addr) });

        // Sensitive staff-only
        if (l.propertyLicenseNumber) push({ title: "Property license (staff only)", category: "Compliance", visibility: "internal", content: `License #: ${l.propertyLicenseNumber}` });

        // Defensive Hostify enrichment: amenities, house rules, area notes.
        if (fetchHostify && this.apiKey) {
            try {
                const details: any = await this.hostify.getListingDetails(this.apiKey, String(l.id));
                const li = details?.listing ?? details?.data ?? details ?? null;
                if (li) {
                    const amenities = li.amenities || li.amenities_list || null;
                    if (Array.isArray(amenities) && amenities.length) {
                        const names = amenities
                            .map((a: any) => (typeof a === "string" ? a : a?.name || a?.title))
                            .filter(Boolean)
                            .slice(0, 80);
                        if (names.length) push({ title: "Amenities", category: "Amenities", visibility: "external", content: names.join(", ") });
                    }
                    const houseRules = li.house_rules || li.houseRules || li.rules;
                    if (houseRules) push({ title: "House rules", category: "Rules", visibility: "external", content: this.clean(houseRules).slice(0, 4000) });
                    const checkinInstr = li.checkin_instructions || li.check_in_instructions || li.arrival_instructions;
                    if (checkinInstr) push({ title: "Check-in instructions", category: "Check-in", visibility: "external", content: this.clean(checkinInstr).slice(0, 4000) });
                    const space = li.space || li.summary_space;
                    if (space) push({ title: "The space", category: "Overview", visibility: "external", content: this.clean(space).slice(0, 4000) });
                    const access = li.access || li.guest_access;
                    if (access) push({ title: "Guest access", category: "Overview", visibility: "external", content: this.clean(access).slice(0, 4000) });
                    const neighborhood = li.neighborhood_overview || li.neighborhood || li.transit;
                    if (neighborhood) push({ title: "Neighborhood & getting around", category: "Location", visibility: "external", content: this.clean(neighborhood).slice(0, 4000) });
                }
            } catch {
                /* non-fatal */
            }
        }

        return entries;
    }

    private async upsert(listingId: number, e: SeedEntry): Promise<boolean> {
        const existing = await this.kbRepo.findOne({ where: { listingId: listingId as any, title: e.title, source: SOURCE } });
        if (existing) {
            // Don't clobber if unchanged; only update when content actually differs.
            if (existing.content === e.content && existing.visibility === e.visibility && existing.isArchived === 0) return false;
            existing.content = e.content;
            existing.visibility = e.visibility;
            existing.category = e.category;
            existing.isArchived = 0;
            await this.kbRepo.save(existing);
            return true;
        }
        const row = this.kbRepo.create({
            listingId,
            category: e.category,
            visibility: e.visibility,
            title: e.title,
            content: e.content,
            source: SOURCE,
            createdByName: "Listing import",
            updatedByName: "Listing import",
            isArchived: 0,
        });
        await this.kbRepo.save(row);
        return true;
    }
}
