/**
 * Roomify-facing read-only endpoints on the SecureStay server.
 *
 * These power the Roomify cleaner app's pre-cleaning brief, property
 * picker, and report flows. They are intentionally separated from the
 * dashboard's own routes so they can be reviewed and re-deployed in
 * isolation, and so a redeploy of the dashboard's code can never wipe
 * them out (this file lives at src/router/roomifyRoutes.ts and MUST be
 * registered in src/router/appRoutes.ts under /listings, /reviews, and
 * /cleaner-report).
 *
 * Auth: re-uses verifySession, which already accepts the `x-api-key`
 * header against UserApiKeyEntity. Roomify is provisioned with the same
 * key the dashboard uses for its API consumers, so no new auth surface
 * is added here.
 *
 * Response shape mirrors what the existing SecureStayClient on the
 * Roomify side expects:
 *   {
 *     status: "success",        // string OR boolean true accepted by client
 *     data:   <payload>,
 *     ...    // pagination metadata (total, currentPage, totalPages)
 *   }
 */

import { Router, Request, Response } from "express";
import { Brackets } from "typeorm";
import verifySession from "../middleware/verifySession";
import { appDatabase } from "../utils/database.util";
import { Listing } from "../entity/Listing";
import { ReviewEntity } from "../entity/Review";
import { Issue } from "../entity/Issue";
import { ActionItems } from "../entity/ActionItems";

// ---------- Helpers ----------

function ok(res: Response, data: any, extras: Record<string, any> = {}) {
  return res.json({ status: "success", data, ...extras });
}

function fail(res: Response, message: string, code = 500) {
  return res
    .status(code)
    .json({ status: false, message, originalMessage: message });
}

function joinAddress(l: any): string {
  if (l.address && String(l.address).trim()) {
    return String(l.address).trim().replace(/,\s*$/, "");
  }
  const parts = [l.street, l.city, l.state, l.zipcode, l.country]
    .filter((p) => p && String(p).trim())
    .map((p) => String(p).trim());
  return parts.join(", ");
}

/**
 * Pulls the bedroom count from a SecureStay listing. The canonical
 * column is `bedroomsNumber` (populated on 100% of catalog rows). We
 * also accept `bedrooms` as a convenience alias for code paths that
 * pre-shape the data.
 */
function bedroomsOf(l: any): number | null {
  const n = Number(l.bedroomsNumber ?? l.bedrooms ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function bathroomsOf(l: any): number | null {
  const n = Number(l.bathroomsNumber ?? l.bathrooms ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function guestsOf(l: any): number | null {
  for (const v of [l.guests, l.personCapacity, l.guestsIncluded]) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

/**
 * Roomify mobile/web reads `listing_id` (NOT `id`). The legacy fallback
 * shape (`fetchCatalogFromIssuesFeed`) defines the canonical key set:
 * listing_id, name, internal_name, full_address, street, city, state,
 * zipcode, country, timezone, bedrooms, bathrooms, guests,
 * thumbnail_url. We mirror that exactly so the property picker and the
 * import flow work without any client-side adapters.
 */
function shapeListing(l: any) {
  if (!l) return null;
  const id = String(l.id);
  const fullAddress = joinAddress(l);
  return {
    listing_id: id,
    id, // kept for any older callers
    name: l.name || l.internalListingName || l.externalListingName || null,
    nickname: l.internalListingName || l.externalListingName || null,
    internal_name: l.internalListingName || null,
    full_address: fullAddress,
    address: l.address || null,
    street: l.street || null,
    city: l.city || null,
    state: l.state || null,
    country: l.country || null,
    countryCode: l.countryCode || null,
    zipcode: l.zipcode || null,
    timezone: l.timeZoneName || l.timezone || null,
    lat: l.lat ?? null,
    lng: l.lng ?? null,
    propertyType: l.propertyType || null,
    guests: guestsOf(l),
    guestsIncluded: l.guestsIncluded ?? null,
    bedrooms: bedroomsOf(l),
    bathrooms: bathroomsOf(l),
    beds: l.beds ?? null,
    price: l.price ?? null,
    thumbnail_url: l.thumbnailUrl || l.thumbnail_url || null,
  };
}

/**
 * Heuristic feature detection from the listing's name + description.
 *
 * The `listing_amenities` table is currently empty for the entire
 * catalog (verified 2026-04-30), so we cannot rely on structured
 * amenities. We fall back to scanning the marketing copy — which is
 * how "Heated Pool/Spa • Theater • Gym" gets correctly turned into
 * Pool / Spa / Theater / Gym rooms.
 */
function detectFeatures(listing: any) {
  const haystack = [
    listing.name,
    listing.internalListingName,
    listing.externalListingName,
    listing.description,
    listing.tags,
    Array.isArray(listing.listingAmenities)
      ? listing.listingAmenities.map((a: any) => a && a.amenityName).join(" ")
      : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const has = (re: RegExp) => re.test(haystack);

  return {
    pool: has(/\bpool\b/),
    hotTub: has(/\b(hot\s*tub|jacuzzi|spa)\b/),
    theater: has(/\b(theater|theatre|cinema|movie\s*room)\b/),
    gym: has(/\b(gym|fitness|workout)\b/),
    gameRoom: has(/\b(game\s*room|arcade|pool\s*table|ping\s*pong)\b/),
    bbq: has(/\b(bbq|barbecue|grill)\b/),
    patio: has(/\b(patio|deck|porch|balcony|lanai|terrace)\b/),
    yard: has(/\b(yard|garden|outdoor)\b/),
    garage: has(/\bgarage\b/),
    laundry: has(/\b(laundry|washer|dryer)\b/),
    waterfront: has(/\b(waterfront|beach|lake|river|canal|ocean|bay)\b/),
    fireplace: has(/\bfire\s*pit|fireplace\b/),
  };
}

/**
 * Generates a Roomify property template from a SecureStay listing.
 * Roomify's create-property flow (and the test in
 * server/test-securestay-flow.js) requires:
 *   {
 *     name, address, timezone, securestay_listing_id,
 *     units: [{ name, notes, rooms: [{ name, type }] }]
 *   }
 * with `units[0].rooms.length > 0`. We synthesize a sensible default
 * room list from the listing's bedroomsNumber/bathroomsNumber columns
 * plus name-based feature detection (pool, spa, theater, etc.) so the
 * cleaner sees an accurate set of areas to inspect — they can still
 * edit before confirming the import.
 */
function buildPropertyTemplate(listing: any) {
  const id = String(listing.id);
  const bedrooms = Math.max(1, bedroomsOf(listing) || 1);
  const bathrooms = Math.max(1, bathroomsOf(listing) || 1);
  const features = detectFeatures(listing);
  const isHouseLike = !/\b(apartment|condo|studio|loft|hotel|hostel|room)\b/i.test(
    String(listing.propertyType || "")
  );

  const rooms: { name: string; type: string }[] = [];

  // Bedrooms
  for (let i = 1; i <= bedrooms; i++) {
    rooms.push({
      name: i === 1 ? "Master Bedroom" : `Bedroom ${i}`,
      type: "bedroom",
    });
  }

  // Common indoor living spaces
  rooms.push({ name: "Living Room", type: "living" });
  rooms.push({ name: "Kitchen", type: "kitchen" });
  if (bedrooms >= 3) {
    rooms.push({ name: "Dining Room", type: "dining" });
  }

  // Bathrooms
  for (let i = 1; i <= bathrooms; i++) {
    rooms.push({
      name: i === 1 && bathrooms > 1 ? "Master Bathroom" : `Bathroom ${i}`,
      type: "bathroom",
    });
  }

  // Specialty rooms detected from the marketing copy
  if (features.theater) rooms.push({ name: "Theater Room", type: "theater" });
  if (features.gameRoom) rooms.push({ name: "Game Room", type: "game" });
  if (features.gym) rooms.push({ name: "Gym", type: "gym" });
  if (features.laundry) rooms.push({ name: "Laundry Room", type: "laundry" });
  if (features.garage) rooms.push({ name: "Garage", type: "garage" });

  // Outdoor — always for house-like properties (villas, houses, cabins).
  // Cleaners need to walk the exterior even if the listing copy doesn't
  // mention a patio, so this is the default for any non-apartment.
  if (isHouseLike || features.patio || features.yard) {
    rooms.push({ name: "Outdoor / Patio", type: "outdoor" });
  }
  if (features.pool) rooms.push({ name: "Pool Area", type: "pool" });
  if (features.hotTub) rooms.push({ name: "Hot Tub / Spa", type: "spa" });
  if (features.bbq) rooms.push({ name: "BBQ / Grill Area", type: "bbq" });

  return {
    name:
      listing.name ||
      listing.internalListingName ||
      listing.externalListingName ||
      `Listing ${id}`,
    address: joinAddress(listing),
    timezone: listing.timeZoneName || listing.timezone || "UTC",
    securestay_listing_id: id,
    counts: {
      bedrooms,
      bathrooms,
      rooms: rooms.length,
    },
    features,
    units: [
      {
        name: "Main Property",
        notes: "",
        rooms,
      },
    ],
  };
}

function shapeReview(r: any) {
  if (!r) return null;
  return {
    id: r.id,
    listing_id: r.listingMapId != null ? String(r.listingMapId) : null,
    listing_name: r.listingName,
    reviewer_name: r.reviewerName || r.guestName || null,
    guest_name: r.guestName,
    rating: r.rating,
    public_review: r.publicReview,
    private_review: r.privateReview,
    submitted_at: r.submittedAt,
    arrival_date: r.arrivalDate,
    departure_date: r.departureDate,
    channel: r.channelName,
  };
}

function parseListingIdParam(value: any): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

// ---------- Enrichment loaders ----------
//
// The dashboard schema scatters cleaner-relevant data across several
// tables that aren't wired up via TypeORM relations on the Listing
// entity (`listing_image`, `property_info`, and `client_properties`).
// Rather than declare new entities just to read a few columns, we
// issue narrow raw queries via the existing connection. All loaders
// are best-effort: if any throws, the calling endpoint continues with
// the basic listing data so the picker / template never goes down
// because of an enrichment failure.

/**
 * Returns Map<listingIdString, thumbnailUrl> for the given listing
 * ids. Picks the lowest-sortOrder image per listing as the cover.
 */
async function loadThumbnailMap(
  listingIds: Array<string | number>
): Promise<Map<string, string | null>> {
  if (!listingIds || listingIds.length === 0) return new Map();
  try {
    const ids = listingIds
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) return new Map();
    const rows: Array<{
      listingId: number;
      thumbnailUrl: string | null;
      url: string | null;
    }> = await appDatabase.query(
      `SELECT li.listingId, li.thumbnailUrl, li.url
         FROM listing_image li
         JOIN (
           SELECT listingId, MIN(COALESCE(sortOrder, 999999)) AS minOrder
             FROM listing_image
            WHERE listingId IN (${ids.map(() => "?").join(",")})
            GROUP BY listingId
         ) m ON m.listingId = li.listingId
              AND COALESCE(li.sortOrder, 999999) = m.minOrder`,
      ids
    );
    const out = new Map<string, string | null>();
    for (const r of rows) {
      if (!out.has(String(r.listingId))) {
        out.set(String(r.listingId), r.thumbnailUrl || r.url || null);
      }
    }
    return out;
  } catch (err: any) {
    console.warn(
      "[roomifyRoutes] loadThumbnailMap failed (returning empty):",
      err?.message
    );
    return new Map();
  }
}

/**
 * Returns the up-to-N image URLs for one listing, ordered by
 * sortOrder.
 */
async function loadImageList(
  listingId: string | number,
  limit = 5
): Promise<
  Array<{ url: string | null; thumbnail_url: string | null; caption: string | null }>
> {
  try {
    const id = Number(listingId);
    if (!Number.isFinite(id)) return [];
    const rows: Array<{
      thumbnailUrl: string | null;
      url: string | null;
      caption: string | null;
      sortOrder: number | null;
    }> = await appDatabase.query(
      `SELECT thumbnailUrl, url, caption, sortOrder
         FROM listing_image
        WHERE listingId = ?
        ORDER BY COALESCE(sortOrder, 999999) ASC
        LIMIT ?`,
      [id, limit]
    );
    return rows.map((r) => ({
      url: r.url || null,
      thumbnail_url: r.thumbnailUrl || null,
      caption: r.caption || null,
    }));
  } catch (err: any) {
    console.warn(
      "[roomifyRoutes] loadImageList failed (returning empty):",
      err?.message
    );
    return [];
  }
}

/**
 * Returns the property_info row for a listing, joined through
 * client_properties.listingId -> client_properties.id =
 * property_info.clientPropertyId. Returns null when no row exists or
 * if the underlying tables are unavailable.
 */
async function loadPropertyInfo(
  listingId: string | number
): Promise<any | null> {
  try {
    const id = Number(listingId);
    if (!Number.isFinite(id)) return null;
    // A single listingId can map to multiple property_info rows
    // (intake/migration creates duplicates), and only one of them is
    // typically populated. Score each row by how many cleaner-relevant
    // fields it has so we pick the most useful one. Tie-break on
    // updatedAt to prefer the most recently edited row.
    const rows: any[] = await appDatabase.query(
      `SELECT pi.*
         FROM property_info pi
         JOIN client_properties cp ON cp.id = pi.clientPropertyId
        WHERE cp.listingId = ?
        ORDER BY (
          (pi.wifiPassword IS NOT NULL AND pi.wifiPassword != '' AND pi.wifiPassword != '(NO PASSWORD)') +
          (pi.standardDoorCode IS NOT NULL AND pi.standardDoorCode != '') +
          (pi.lockboxCode IS NOT NULL AND pi.lockboxCode != '') +
          (pi.parkingInstructions IS NOT NULL AND pi.parkingInstructions != '') +
          (pi.wasteCollectionDays IS NOT NULL AND pi.wasteCollectionDays != '') +
          (pi.swimmingPoolNotes IS NOT NULL AND pi.swimmingPoolNotes != '') +
          (pi.hotTubInstructions IS NOT NULL AND pi.hotTubInstructions != '') +
          (pi.securityCameraLocations IS NOT NULL AND pi.securityCameraLocations != '') +
          (pi.checkInInstructions IS NOT NULL AND pi.checkInInstructions != '') +
          (pi.otherHouseRules IS NOT NULL AND pi.otherHouseRules != '')
        ) DESC, pi.updatedAt DESC
        LIMIT 1`,
      [String(id)]
    );
    return rows[0] || null;
  } catch (err: any) {
    console.warn(
      "[roomifyRoutes] loadPropertyInfo failed (returning null):",
      err?.message
    );
    return null;
  }
}

/**
 * Strips noise like "(NO PASSWORD)" / "(NOT SPECIFIED)" placeholders
 * from a string field. Returns null for empty or sentinel values.
 */
function cleanString(v: any, max = 2000): string | null {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  if (/^\((no|not)[^)]*\)$/i.test(s)) return null;
  if (s.length > max) s = s.slice(0, max);
  return s;
}

/**
 * Reshapes a property_info row into a cleaner-facing notes object.
 * Returns null when nothing useful is populated (every leaf is empty).
 * Keys are present even when null so clients can render a stable
 * layout.
 */
function shapeCleanerNotes(pi: any): any | null {
  if (!pi) return null;
  const notes = {
    door: {
      standard_code: cleanString(pi.standardDoorCode, 50),
      lockbox_code: cleanString(pi.lockboxCode, 50),
      lockbox_location: cleanString(pi.lockboxLocation, 200),
      instructions: cleanString(pi.doorLockInstructions, 1500),
    },
    wifi: {
      ssid: cleanString(pi.wifiUsername, 100),
      password: cleanString(pi.wifiPassword, 100),
      speed: cleanString(pi.wifiSpeed, 50),
    },
    parking: cleanString(pi.parkingInstructions, 1500),
    check_in: cleanString(pi.checkInInstructions, 2000),
    check_out: cleanString(pi.checkOutInstructions, 2000),
    waste: {
      collection_days: cleanString(pi.wasteCollectionDays, 200),
      bin_location: cleanString(pi.wasteBinLocation, 500),
      management: cleanString(pi.wasteManagementInstructions, 1500),
    },
    pool: cleanString(pi.swimmingPoolNotes, 2000),
    hot_tub: cleanString(pi.hotTubInstructions, 2000),
    fire_pit: cleanString(pi.firepitNotes, 1000),
    fireplace: cleanString(pi.firePlaceNotes, 1000),
    gym: cleanString(pi.gymNotes, 1000),
    bedroom_notes: cleanString(pi.bedroomNotes, 2000),
    security_cameras: cleanString(pi.securityCameraLocations, 1000),
    house_rules: cleanString(pi.otherHouseRules, 2000),
    pets: {
      allowed:
        pi.allowPets === 1 || pi.allowPets === "1"
          ? true
          : pi.allowPets === 0 || pi.allowPets === "0"
          ? false
          : null,
      restrictions: cleanString(pi.petRestrictionsNotes, 1000),
    },
    floors: pi.noOfFloors == null ? null : Number(pi.noOfFloors),
    square_feet: pi.squareFeet == null ? null : Number(pi.squareFeet),
    special_instructions: cleanString(pi.specialInstructions, 2000),
  };

  const isEmpty = (v: any): boolean => {
    if (v == null) return true;
    if (typeof v === "string") return v.length === 0;
    if (typeof v === "object") return Object.values(v).every(isEmpty);
    return false;
  };
  if (isEmpty(notes)) return null;
  return notes;
}

// ---------- /listings ----------

const listingsRouter = Router();

listingsRouter.get("/", verifySession, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const rawLimit = parseInt((req.query.limit as string) || "100", 10);
    const limit = Math.min(Math.max(rawLimit, 1), 500);
    const q = ((req.query.q as string) || "").trim();

    const repo = appDatabase.getRepository(Listing);
    const qb = repo.createQueryBuilder("l");

    if (q) {
      const like = `%${q}%`;
      qb.where(
        new Brackets((b) => {
          b.where("l.name LIKE :q", { q: like })
            .orWhere("l.internalListingName LIKE :q", { q: like })
            .orWhere("l.externalListingName LIKE :q", { q: like })
            .orWhere("l.address LIKE :q", { q: like })
            .orWhere("l.street LIKE :q", { q: like })
            .orWhere("l.city LIKE :q", { q: like });
        })
      );
    }

    qb.orderBy("l.name", "ASC")
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();

    // Best-effort thumbnail enrichment (single batched query for the
    // entire page). Doesn't block the response if it fails.
    const ids = rows.map((r: any) => r.id);
    const thumbs = await loadThumbnailMap(ids);

    const data = rows.map((r: any) => {
      const shaped: any = shapeListing(r);
      if (!shaped.thumbnail_url) {
        const t = thumbs.get(String(r.id));
        if (t) shaped.thumbnail_url = t;
      }
      return shaped;
    });

    return ok(res, data, {
      total,
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    return fail(res, err?.message || "Failed to load listings");
  }
});

listingsRouter.get(
  "/:listingId",
  verifySession,
  async (req: Request, res: Response) => {
    try {
      const { listingId } = req.params;
      if (!listingId || listingId === "undefined" || listingId === "null") {
        return fail(res, "listingId is required", 400);
      }
      const repo = appDatabase.getRepository(Listing);
      const listing = await repo.findOne({
        where: { id: listingId as any },
      } as any);

      if (!listing) return fail(res, "Listing not found", 404);

      // Run all enrichment loads in parallel — each returns a safe
      // empty value on error so a failing aux query never breaks the
      // template fetch.
      const [thumbs, images, propertyInfo] = await Promise.all([
        loadThumbnailMap([(listing as any).id]),
        loadImageList((listing as any).id, 8),
        loadPropertyInfo((listing as any).id),
      ]);

      const shapedListing: any = shapeListing(listing);
      if (!shapedListing.thumbnail_url) {
        shapedListing.thumbnail_url =
          thumbs.get(String((listing as any).id)) || null;
      }
      shapedListing.images = images;

      const template: any = buildPropertyTemplate(listing);
      template.thumbnail_url = shapedListing.thumbnail_url;
      template.images = images;
      template.cleaner_notes = shapeCleanerNotes(propertyInfo);

      return ok(res, { listing: shapedListing, template });
    } catch (err: any) {
      return fail(res, err?.message || "Failed to load listing");
    }
  }
);

// ---------- /reviews ----------

const reviewsRouter = Router();

reviewsRouter.get("/", verifySession, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(
      Math.max(parseInt((req.query.limit as string) || "50", 10), 1),
      200
    );

    const listingIds = parseListingIdParam(req.query.listingId)
      .map((s) => Number(s))
      .filter((n) => !Number.isNaN(n));

    const repo = appDatabase.getRepository(ReviewEntity);
    const qb = repo.createQueryBuilder("r");

    if (listingIds.length > 0) {
      qb.andWhere("r.listingMapId IN (:...listingIds)", { listingIds });
    }
    if (req.query.fromDate) {
      qb.andWhere("r.submittedAt >= :from", {
        from: String(req.query.fromDate),
      });
    }
    if (req.query.toDate) {
      qb.andWhere("r.submittedAt <= :to", { to: String(req.query.toDate) });
    }
    if (req.query.minRating != null && req.query.minRating !== "") {
      qb.andWhere("r.rating >= :minR", { minR: Number(req.query.minRating) });
    }
    if (req.query.maxRating != null && req.query.maxRating !== "") {
      qb.andWhere("r.rating <= :maxR", { maxR: Number(req.query.maxRating) });
    }

    qb.orderBy("r.submittedAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return ok(res, rows.map(shapeReview), { total });
  } catch (err: any) {
    return fail(res, err?.message || "Failed to load reviews");
  }
});

// ---------- /cleaner-report/:listingId ----------

const cleanerReportRouter = Router();

cleanerReportRouter.get(
  "/:listingId",
  verifySession,
  async (req: Request, res: Response) => {
    try {
      const { listingId } = req.params;
      const days = Math.min(
        Math.max(parseInt((req.query.days as string) || "90", 10), 1),
        365
      );
      const limit = Math.min(
        Math.max(parseInt((req.query.limit as string) || "50", 10), 1),
        200
      );
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const listingRepo = appDatabase.getRepository(Listing);
      const issueRepo = appDatabase.getRepository(Issue);
      const actionItemRepo = appDatabase.getRepository(ActionItems);
      const reviewRepo = appDatabase.getRepository(ReviewEntity);

      const listing = await listingRepo.findOne({
        where: { id: listingId as any },
      } as any);

      // ----- Issues -----
      const allIssues = await issueRepo.find({
        where: { listing_id: String(listingId) },
        order: { date_time_reported: "DESC" } as any,
        take: 500,
      });
      const recentIssues = allIssues.filter((i) => {
        if (!i.date_time_reported) return false;
        return new Date(i.date_time_reported as any) >= cutoff;
      });
      const openIssues = allIssues.filter(
        (i) => i.status && i.status !== "Completed"
      );

      // ----- Action items -----
      const recentActionItems = await actionItemRepo.find({
        where: { listingId: Number(listingId) },
        order: { createdAt: "DESC" },
        take: 200,
      });
      const recentActionItemsFiltered = recentActionItems.filter(
        (a) => a.createdAt && new Date(a.createdAt) >= cutoff
      );

      // ----- Reviews (most recent first) -----
      const recentReviews = await reviewRepo.find({
        where: { listingMapId: Number(listingId) } as any,
        order: { submittedAt: "DESC" } as any,
        take: limit,
      });

      // ----- Recurring categories (>=3 occurrences across action items) -----
      // Issue entity has no `category` column; ActionItems does. We rely on
      // the action_items category which is the source of truth Roomify
      // expects.
      const catCounts = new Map<string, number>();
      const bumpCat = (c?: string | null) => {
        if (!c) return;
        const key = String(c).trim();
        if (!key) return;
        catCounts.set(key, (catCounts.get(key) || 0) + 1);
      };
      for (const a of recentActionItems) bumpCat(a.category);

      const recurring_categories = Array.from(catCounts.entries())
        .filter(([, count]) => count >= 3)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // ----- Low-rated guest quotes -----
      const low_rated_quotes = recentReviews
        .filter(
          (r) =>
            typeof r.rating === "number" &&
            (r.rating as number) <= 3 &&
            r.publicReview
        )
        .slice(0, 10)
        .map((r) => ({
          rating: r.rating,
          public_review: r.publicReview,
          guest_name: r.guestName,
          submitted_at: r.submittedAt,
        }));

      // ----- watch_for: short cleaner-facing signal lines -----
      const watch_for: { type: string; text: string; weight: number }[] = [];

      if (openIssues.length > 0) {
        watch_for.push({
          type: "open_issues",
          text: `${openIssues.length} open issue${openIssues.length > 1 ? "s" : ""} on this property`,
          weight: 3,
        });
      }
      for (const r of recurring_categories.slice(0, 3)) {
        watch_for.push({
          type: "recurring_category",
          text: `Recurring ${r.category} (${r.count})`,
          weight: 2,
        });
      }
      for (const i of openIssues.slice(0, 5)) {
        if (i.issue_description) {
          watch_for.push({
            type: "open_issue",
            text: String(i.issue_description).slice(0, 240),
            weight: 2,
          });
        }
      }
      for (const a of recentActionItemsFiltered.slice(0, 5)) {
        if (a.item)
          watch_for.push({
            type: "action_item",
            text: String(a.item).slice(0, 240),
            weight: 1,
          });
      }

      // ----- Last guest signal (most recent review) -----
      const lastReview = recentReviews[0] || null;

      // Best-effort static enrichment — door code, wifi, parking,
      // pool/hot tub instructions, security camera locations, etc.
      // pulled from property_info via client_properties.
      const [propertyInfo, thumbs] = await Promise.all([
        loadPropertyInfo(listingId),
        loadThumbnailMap([listingId]),
      ]);
      const cleanerNotes = shapeCleanerNotes(propertyInfo);

      return ok(res, {
        listing_id: String(listingId),
        name:
          (listing as any)?.name ||
          (listing as any)?.internalListingName ||
          null,
        address: (listing as any)?.address || null,
        timezone:
          (listing as any)?.timeZoneName ||
          (listing as any)?.timezone ||
          null,
        thumbnail_url: thumbs.get(String(listingId)) || null,
        window_days: days,
        counts: {
          open_issues: openIssues.length,
          recent_issues: recentIssues.length,
          recurring_categories: recurring_categories.length,
          recent_reviews: recentReviews.length,
        },
        watch_for,
        recurring_categories,
        low_rated_quotes,
        cleaner_notes: cleanerNotes,
        last_guest: lastReview
          ? {
              guest_name: lastReview.guestName,
              arrival_date: lastReview.arrivalDate,
              departure_date: lastReview.departureDate,
              review: {
                rating: lastReview.rating,
                public_review: lastReview.publicReview,
                channel: lastReview.channelName,
                submitted_at: lastReview.submittedAt,
              },
              issues_during_or_after_stay: [],
            }
          : null,
      });
    } catch (err: any) {
      return fail(res, err?.message || "Failed to build cleaner report");
    }
  }
);

// ---------- exports for appRoutes ----------

export const roomifyListingsRouter = listingsRouter;
export const roomifyReviewsRouter = reviewsRouter;
export const roomifyCleanerReportRouter = cleanerReportRouter;
