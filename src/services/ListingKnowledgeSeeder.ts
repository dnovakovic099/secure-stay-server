import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { Listing } from "../entity/Listing";
import { ListingKnowledgeEntryEntity } from "../entity/ListingKnowledgeEntry";
import { Hostify } from "../client/Hostify";
import { ListingGroupService } from "./ListingGroupService";

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

    /** Convert an hour value (int 0-23, HHmm like 1500, or "16:00:00") to "3:00 PM". */
    private fmtHour(v: any): string | null {
        if (v == null || v === "") return null;
        let n: number;
        if (typeof v === "string" && v.includes(":")) n = Number(v.split(":")[0]);
        else {
            n = Number(v);
            if (Number.isFinite(n) && n > 23) n = Math.floor(n / 100); // 1500-style
        }
        if (!Number.isFinite(n) || n <= 0 || n > 23) return null; // 0 = unset
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
        // withDeleted: soft-deleted listings can still have active guest threads in
        // the inbox, so they still need Knowledge Base grounding for the bot.
        const listings = await this.listingRepo.find({ take: opts.limit ?? 5000, withDeleted: true });
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

    /**
     * Seed KB for listing IDs that are NOT necessarily in listing_info — i.e. the
     * channel/child listing IDs the inbox actually uses. Everything is derived
     * from the Hostify listing detail (name, description incl. parking, amenities,
     * house rules, fees, check-in/out, location), so per-property facts are
     * grounded even when we only have the OTA child ID.
     */
    async seedListingsFromHostify(
        listingIds: number[],
        opts: { onlyMissing?: boolean } = {}
    ): Promise<{ listings: number; entries: number }> {
        let listingCount = 0;
        let entryCount = 0;
        for (const listingId of listingIds) {
            try {
                if (opts.onlyMissing) {
                    const existing = await this.kbRepo.count({ where: { listingId: listingId as any, isArchived: 0 } });
                    if (existing > 0) continue;
                }
                if (!this.apiKey) break;
                const details: any = await this.hostify.getListingDetails(this.apiKey, String(listingId));
                if (!details?.listing) continue;
                const entries = this.buildEntriesFromHostify(details);
                for (const e of entries) if (await this.upsert(listingId, e)) entryCount++;
                await this.reconcile(listingId, entries.map((e) => e.title));
                if (entries.length) listingCount++;
            } catch (err: any) {
                logger.warn(`[KBSeeder] Hostify seed failed for ${listingId}: ${err.message}`);
            }
        }
        logger.info(`[KBSeeder] Hostify-seeded ${entryCount} entries across ${listingCount} listings`);
        return { listings: listingCount, entries: entryCount };
    }

    /** Build KB entries purely from a Hostify getListingDetails payload. */
    private buildEntriesFromHostify(details: any): SeedEntry[] {
        const li = details.listing || {};
        const entries: SeedEntry[] = [];
        const push = (e: SeedEntry) => {
            if (e.content && e.content.trim()) entries.push(e);
        };
        const cur = li.currency || "USD";

        // Overview
        const ov: string[] = [];
        if (li.property_type) ov.push(`Property type: ${li.property_type}.`);
        if (li.bedrooms != null) ov.push(`${li.bedrooms} bedroom(s).`);
        if (li.bathrooms != null) ov.push(`${li.bathrooms} bathroom(s).`);
        if (li.beds != null && Number(li.beds) > 0) ov.push(`${li.beds} bed(s).`);
        const cap = li.person_capacity ?? li.guests_included;
        if (cap != null) ov.push(`Sleeps up to ${cap} guest(s).`);
        if (li.area != null && Number(li.area) > 0) ov.push(`Approx. ${li.area} sq ft.`);
        push({ title: "Property overview", category: "Overview", visibility: "external", content: ov.join(" ") });

        // Description (flatten the description object/string — this holds parking,
        // access notes, neighborhood, etc.).
        const descText = this.flattenDescription(details.description);
        if (!this.isBlank(descText)) push({ title: "Listing description", category: "Overview", visibility: "external", content: this.clean(descText).slice(0, 6000) });
        if (!this.isBlank(li.house_manual)) push({ title: "House manual", category: "Check-in", visibility: "external", content: this.clean(li.house_manual).slice(0, 4000) });
        if (!this.isBlank(li.directions)) push({ title: "Directions", category: "Location", visibility: "external", content: this.clean(li.directions).slice(0, 3000) });

        // Check-in / out
        const ci = this.fmtHour(li.checkin_start);
        const co = this.fmtHour(li.checkout);
        const t: string[] = [];
        if (ci) t.push(`Check-in: from ${ci}.`);
        if (co) t.push(`Check-out: by ${co}.`);
        if (li.timezone) t.push(`Local time zone: ${li.timezone}.`);
        push({ title: "Check-in / check-out times", category: "Check-in", visibility: "external", content: t.join(" ") });

        // Fees
        const fees: string[] = [];
        if (Number(li.cleaning_fee) > 0) fees.push(`Cleaning fee: ${cur} ${li.cleaning_fee}.`);
        if (Number(li.pets_fee) > 0) fees.push(`Pet fee: ${cur} ${li.pets_fee}.`);
        if (Number(li.extra_person) > 0) fees.push(`Extra guest fee: ${cur} ${li.extra_person}/person beyond ${li.guests_included ?? 1} included.`);
        push({ title: "Fees", category: "Pricing", visibility: "external", content: fees.join(" ") });
        if (Number(li.security_deposit) > 0)
            push({ title: "Security deposit (staff only)", category: "Pricing", visibility: "internal", content: `Refundable security deposit on file: ${cur} ${li.security_deposit}.` });

        // Amenities
        const amenities = details.amenities;
        if (Array.isArray(amenities) && amenities.length) {
            const names = Array.from(
                new Set(amenities.map((a: any) => (typeof a === "string" ? a : a?.name)).filter((n: any) => n && String(n).trim()).map((n: string) => String(n).trim()))
            ).slice(0, 100);
            if (names.length) push({ title: "Amenities", category: "Amenities", visibility: "external", content: names.join(", ") });
        }

        // House rules
        const yes = (v: any) => String(v) === "1" || v === true;
        const rules: string[] = [];
        if (li.pets_allowed !== undefined) rules.push(yes(li.pets_allowed) ? "Pets are allowed." : "Pets are not allowed.");
        if (li.smoking_allowed !== undefined) rules.push(yes(li.smoking_allowed) ? "Smoking is allowed." : "No smoking.");
        if (li.events_allowed !== undefined) rules.push(yes(li.events_allowed) ? "Events/parties are allowed." : "No parties or events.");
        if (li.children_allowed !== undefined) rules.push(yes(li.children_allowed) ? "Children are welcome." : "Not suitable for children.");
        const qf = this.fmtHour(li.quiet_hours_from);
        const qt = this.fmtHour(li.quiet_hours_to);
        if (qf && qt) rules.push(`Quiet hours: ${qf} to ${qt}.`);
        if (rules.length) push({ title: "House rules", category: "Rules", visibility: "external", content: rules.join(" ") });

        // Full house-rules TEXT as written by the host (the version the team
        // pastes to guests). The flag summary above misses fees, guest limits,
        // registration requirements etc., so the bot deflected instead of
        // sending the actual rules.
        const rulesText = !this.isBlank(li.house_rules)
            ? li.house_rules
            : details.description && !this.isBlank(details.description.house_rules)
              ? details.description.house_rules
              : "";
        if (!this.isBlank(rulesText))
            push({ title: "House rules (full text)", category: "Rules", visibility: "external", content: this.clean(rulesText).slice(0, 5000) });

        // Stay length
        const stay: string[] = [];
        if (li.min_nights != null) stay.push(`Minimum stay: ${li.min_nights} night(s).`);
        if (li.max_nights != null && Number(li.max_nights) > 0) stay.push(`Maximum stay: ${li.max_nights} night(s).`);
        push({ title: "Stay length & booking", category: "Booking", visibility: "external", content: stay.join(" ") });

        // Location
        const loc: string[] = [];
        if (li.city) loc.push(li.city);
        if (li.state) loc.push(li.state);
        if (li.country) loc.push(li.country);
        push({ title: "General location", category: "Location", visibility: "external", content: loc.length ? `Located in ${loc.join(", ")}.` : "" });
        const addr = !this.isBlank(li.address) ? li.address : !this.isBlank(li.street) ? li.street : "";
        push({ title: "Full address (staff only)", category: "Location", visibility: "internal", content: this.clean(addr) });

        return entries;
    }

    /** Flatten Hostify's description (object of sections or a string) to text. */
    private flattenDescription(d: any): string {
        if (!d) return "";
        if (typeof d === "string") return d;
        if (Array.isArray(d)) return d.map((x) => this.flattenDescription(x)).join("\n");
        if (typeof d === "object") {
            return Object.values(d)
                .filter((v) => typeof v === "string" && v.trim())
                .join("\n");
        }
        return "";
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

    /** In-process guard so an on-demand seed is attempted at most once per listing. */
    private static selfHealAttempts = new Set<number>();

    /**
     * Self-heal a single listing that just showed up in the inbox with no
     * Knowledge Base. Hostify splits one property into per-channel child IDs, so
     * a brand-new reservation can arrive on a child ID we've never seeded —
     * leaving the bot with zero listing grounding. This pulls that listing's KB
     * straight from Hostify on demand (idempotent). No-op if the listing (or its
     * resolved parent group) is already covered. Returns new entries created.
     */
    async ensureListingSeeded(listingId: number | null | undefined): Promise<number> {
        const id = listingId ? Number(listingId) : 0;
        if (!id || ListingKnowledgeSeeder.selfHealAttempts.has(id)) return 0;
        ListingKnowledgeSeeder.selfHealAttempts.add(id);
        try {
            const groupIds = await new ListingGroupService().groupIds(id).catch(() => [id]);
            const covered = await this.kbRepo.count({
                where: { listingId: In(groupIds.length ? groupIds : [id]) as any, isArchived: 0 },
            });
            if (covered > 0) return 0;
            const res = await this.seedListingsFromHostify([id], { onlyMissing: true });
            if (res.entries) logger.info(`[KBSeeder] self-healed listing ${id}: +${res.entries} KB entries`);
            return res.entries;
        } catch (e: any) {
            logger.warn(`[KBSeeder] self-heal failed for ${listingId}: ${e.message}`);
            return 0;
        }
    }

    /**
     * Nightly safety net: find every listing that has an inbox conversation but
     * no Knowledge Base (after group resolution) and seed it from Hostify. Keeps
     * coverage complete as new reservations/child IDs appear over time.
     */
    async sweepMissingConversationKnowledge(): Promise<{ scanned: number; seeded: number; entries: number }> {
        const rows: { listingId: number }[] = await appDatabase.query(
            `SELECT DISTINCT listingId FROM inbox_conversations WHERE listingId IS NOT NULL`
        );
        const groups = new ListingGroupService();
        const missing: number[] = [];
        for (const r of rows) {
            const id = Number(r.listingId);
            if (!id) continue;
            const groupIds = await groups.groupIds(id).catch(() => [id]);
            const covered = await this.kbRepo.count({
                where: { listingId: In(groupIds.length ? groupIds : [id]) as any, isArchived: 0 },
            });
            if (covered === 0) missing.push(id);
        }
        if (!missing.length) return { scanned: rows.length, seeded: 0, entries: 0 };
        const res = await this.seedListingsFromHostify(missing, { onlyMissing: true });
        logger.info(`[KBSeeder] nightly sweep seeded ${res.entries} entries across ${res.listings} listings (${missing.length} were missing)`);
        return { scanned: rows.length, seeded: res.listings, entries: res.entries };
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

        // Defensive Hostify enrichment: amenities (top-level array) + house-rule flags.
        if (fetchHostify && this.apiKey) {
            try {
                const details: any = await this.hostify.getListingDetails(this.apiKey, String(l.id));
                const li: any = details?.listing ?? {};

                // Amenities: top-level array of { name } — huge for parking/kitchen/AC questions.
                const amenities = details?.amenities;
                if (Array.isArray(amenities) && amenities.length) {
                    const names = Array.from(
                        new Set(
                            amenities
                                .map((a: any) => (typeof a === "string" ? a : a?.name))
                                .filter((n: any) => n && String(n).trim())
                                .map((n: string) => String(n).trim())
                        )
                    ).slice(0, 100);
                    if (names.length) push({ title: "Amenities", category: "Amenities", visibility: "external", content: names.join(", ") });
                }

                // House rules derived from listing flags.
                const yes = (v: any) => String(v) === "1" || v === true;
                const rules: string[] = [];
                if (li.pets_allowed !== undefined) rules.push(yes(li.pets_allowed) ? "Pets are allowed." : "Pets are not allowed.");
                if (li.smoking_allowed !== undefined) rules.push(yes(li.smoking_allowed) ? "Smoking is allowed." : "No smoking.");
                if (li.events_allowed !== undefined) rules.push(yes(li.events_allowed) ? "Events/parties are allowed." : "No parties or events.");
                if (li.children_allowed !== undefined) rules.push(yes(li.children_allowed) ? "Children are welcome." : "Not suitable for children.");
                const qf = this.fmtHour(li.quiet_hours_from);
                const qt = this.fmtHour(li.quiet_hours_to);
                if (qf && qt) rules.push(`Quiet hours: ${qf} to ${qt}.`);
                if (rules.length) push({ title: "House rules", category: "Rules", visibility: "external", content: rules.join(" ") });

                // Fees fallback: our listing_info.cleaningFee is often 0 while the
                // Hostify listing detail carries the real fees. Fees are a top guest
                // question, so backfill from Hostify when we produced no Fees entry.
                const cur = li.currency || l.currencyCode || "USD";
                if (!entries.some((e) => e.title === "Fees")) {
                    const f: string[] = [];
                    if (Number(li.cleaning_fee) > 0) f.push(`Cleaning fee: ${cur} ${li.cleaning_fee}.`);
                    if (Number(li.pets_fee) > 0) f.push(`Pet fee: ${cur} ${li.pets_fee}.`);
                    if (Number(li.extra_person) > 0) f.push(`Extra guest fee: ${cur} ${li.extra_person}/person.`);
                    if (f.length) push({ title: "Fees", category: "Pricing", visibility: "external", content: f.join(" ") });
                }
                // Security deposit is staff-only: "deposit" always routes to a human,
                // so the bot should be informed but never quote the amount.
                if (Number(li.security_deposit) > 0)
                    push({ title: "Security deposit (staff only)", category: "Pricing", visibility: "internal", content: `Refundable security deposit on file: ${cur} ${li.security_deposit}.` });

                // Beds / area augmentation.
                const extra: string[] = [];
                if (li.beds != null && Number(li.beds) > 0) extra.push(`${li.beds} bed(s).`);
                if (li.area != null && Number(li.area) > 0) extra.push(`Approx. ${li.area} sq ft.`);
                if (extra.length) push({ title: "Size & sleeping", category: "Overview", visibility: "external", content: extra.join(" ") });
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
