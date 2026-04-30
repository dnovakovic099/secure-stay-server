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
    timezone: l.timezone || null,
    lat: l.lat ?? null,
    lng: l.lng ?? null,
    propertyType: l.propertyType || null,
    guests: l.guestsIncluded ?? null,
    guestsIncluded: l.guestsIncluded ?? null,
    bedrooms: l.bedrooms ?? null,
    bathrooms: l.bathrooms ?? null,
    beds: l.beds ?? null,
    price: l.price ?? null,
    thumbnail_url: l.thumbnailUrl || l.thumbnail_url || null,
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
 * room list from the listing's bedrooms/bathrooms columns so the
 * cleaner can immediately start an inspection — they can edit before
 * confirming the import.
 */
function buildPropertyTemplate(listing: any) {
  const id = String(listing.id);
  const bedrooms = Math.max(1, Number(listing.bedrooms) || 1);
  const bathrooms = Math.max(1, Number(listing.bathrooms) || 1);

  const rooms: { name: string; type: string }[] = [];
  for (let i = 1; i <= bedrooms; i++) {
    rooms.push({
      name: i === 1 ? "Master Bedroom" : `Bedroom ${i}`,
      type: "bedroom",
    });
  }
  rooms.push({ name: "Living Room", type: "living" });
  rooms.push({ name: "Kitchen", type: "kitchen" });
  for (let i = 1; i <= bathrooms; i++) {
    rooms.push({
      name: i === 1 && bathrooms > 1 ? "Master Bathroom" : `Bathroom ${i}`,
      type: "bathroom",
    });
  }

  return {
    name:
      listing.name ||
      listing.internalListingName ||
      listing.externalListingName ||
      `Listing ${id}`,
    address: joinAddress(listing),
    timezone: listing.timezone || "UTC",
    securestay_listing_id: id,
    counts: {
      bedrooms,
      bathrooms,
      rooms: rooms.length,
    },
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

    return ok(res, rows.map(shapeListing), {
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

      return ok(res, {
        listing: shapeListing(listing),
        template: buildPropertyTemplate(listing),
      });
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

      return ok(res, {
        listing_id: String(listingId),
        name:
          (listing as any)?.name ||
          (listing as any)?.internalListingName ||
          null,
        address: (listing as any)?.address || null,
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
