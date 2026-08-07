import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Issue } from "../entity/Issue";
import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { UpsellOrderService } from "./UpsellOrderService";
import { IssuesService } from "./IssuesService";
import { ListingService } from "./ListingService";
import { ResolutionService } from "./ResolutionService";
import { UpsellQuoteService } from "./UpsellQuoteService";
import { StripeClient } from "../client/StripeClient";
import {
  computeUpsellAmountToPayout,
  extractPmFeePercentFromTags,
  parsePmFeePercent,
} from "../utils/upsellPayoutFee.util";
import logger from "../utils/logger.utils";

const SYSTEM_USER = "AI Assistant";

/**
 * Bridges Upsell Requests & Orders ↔ Guest Issues ↔ Resolutions ↔ Stripe.
 *
 * R&O = money/payment system of record.
 * Guest Issues = work the team has to do (shared discussion).
 */
export class UpsellRequestBridgeService {
  private orderRepo = appDatabase.getRepository(UpsellOrder);
  private issueRepo = appDatabase.getRepository(Issue);
  private listingRepo = appDatabase.getRepository(Listing);
  private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
  private stripeClient = new StripeClient();

  /**
   * Resolve PM fee % for a listing: prefer tag containing "%", else listing_score_info.
   */
  async resolvePmFeePercent(listingId: string | number | null | undefined): Promise<number | null> {
    const id = Number(listingId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const listing = await this.listingRepo.findOne({
      where: { id },
      withDeleted: true,
    } as any);
    const fromTags = extractPmFeePercentFromTags((listing as any)?.tags || "");
    if (fromTags != null) return fromTags;

    try {
      const listingService = new ListingService();
      const rows = await listingService.getListingPmFee(id);
      const raw = rows?.find((r) => Number(r.listingId) === id)?.pmFee;
      return parsePmFeePercent(raw as any);
    } catch {
      return null;
    }
  }

  async computeAmountToPayout(amount: number, listingId: string | number | null | undefined) {
    const pm = await this.resolvePmFeePercent(listingId);
    return {
      amountToPayout: computeUpsellAmountToPayout(amount, pm),
      pmFeePercent: pm,
    };
  }

  /**
   * Match guest text / category against Upsell List catalog for the listing.
   */
  async findMatchingCatalogUpsell(input: {
    listingId: string | number | null | undefined;
    text: string;
    reservationId?: string | number | null;
    checkin?: string | null;
    checkout?: string | null;
  }) {
    const listingId = Number(input.listingId);
    if (!Number.isFinite(listingId) || listingId <= 0) return null;

    const quoteService = new UpsellQuoteService();
    const quotes = await quoteService.listQuotesForListing({
      listingId,
      reservationId: input.reservationId != null ? Number(input.reservationId) : undefined,
      checkin: input.checkin || undefined,
      checkout: input.checkout || undefined,
    });
    if (!quotes.length) return null;

    const hay = String(input.text || "").toLowerCase();
    // Prefer title contained in text or text contained in title.
    const ranked = quotes
      .map((q) => {
        const title = String(q.title || "").toLowerCase().trim();
        if (!title) return { q, score: 0 };
        if (hay.includes(title)) return { q, score: 100 + title.length };
        if (title.includes(hay) && hay.length >= 4) return { q, score: 80 };
        // Token overlap for "late checkout" ↔ "Late Check-Out"
        const titleTokens = title.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
        const hits = titleTokens.filter((t) => hay.includes(t)).length;
        const score = titleTokens.length ? (hits / titleTokens.length) * 60 : 0;
        return { q, score };
      })
      .filter((r) => r.score >= 40)
      .sort((a, b) => b.score - a.score);

    return ranked[0]?.q || null;
  }

  /**
   * Auto-create Interested R&O (+ Stripe link + linked Guest Issue) when the
   * property has a matching Upsell List item.
   */
  async autoCreateRequestOrderForIssue(input: {
    issue: Issue;
    userId?: string;
    forceUpsellTitle?: string | null;
  }): Promise<UpsellOrder | null> {
    const issue = input.issue;
    if (!issue?.id) return null;
    if (issue.upsell_order_id) {
      return this.orderRepo.findOne({ where: { id: issue.upsell_order_id } });
    }

    const text = [
      input.forceUpsellTitle,
      issue.category,
      issue.issue_description,
    ]
      .filter(Boolean)
      .join(" — ");

    const match = await this.findMatchingCatalogUpsell({
      listingId: issue.listing_id,
      text,
      reservationId: issue.reservation_id,
      checkin: issue.check_in_date ? String(issue.check_in_date).slice(0, 10) : null,
    });
    if (!match) {
      logger.info(
        `[UpsellBridge] no catalog upsell match for issue #${issue.id} listing ${issue.listing_id}`
      );
      return null;
    }

    // Dedupe open R&O for same reservation + upsell type.
    if (issue.reservation_id) {
      const existing = await this.orderRepo.findOne({
        where: {
          booking_id: String(issue.reservation_id),
          type: match.title,
          status: In(["Interested", "Ordered", "Pending Payment", "Pending"]),
          archived: false,
        } as any,
      });
      if (existing) {
        await this.linkOrderAndIssue(existing, issue, input.userId || SYSTEM_USER);
        return existing;
      }
    }

    const reservation = issue.reservation_id
      ? await this.reservationRepo
          .findOne({ where: { id: Number(issue.reservation_id) } })
          .catch(() => null)
      : null;

    const cost = Number(match.guestFee) > 0 ? Number(match.guestFee) : 0;
    const orderService = new UpsellOrderService();
    const order = await orderService.createOrder(
      {
        status: "Interested",
        listing_id: String(issue.listing_id || ""),
        listing_name: issue.listing_name || "",
        cost,
        order_date: new Date() as any,
        client_name: issue.guest_name || "",
        type: match.title,
        description: issue.issue_description || `Guest requested ${match.title}`,
        booking_id: issue.reservation_id ? String(issue.reservation_id) : "",
        arrival_date: reservation?.arrivalDate
          ? String(reservation.arrivalDate).slice(0, 10)
          : issue.check_in_date
            ? String(issue.check_in_date).slice(0, 10)
            : null,
        departure_date: reservation?.departureDate
          ? String(reservation.departureDate).slice(0, 10)
          : null,
        phone: issue.guest_contact_number || "",
        payment_method: "Stripe",
        upsell_id: match.upSellId,
        issue_id: issue.id,
      } as any,
      input.userId || SYSTEM_USER
    );

    await this.linkOrderAndIssue(order, issue, input.userId || SYSTEM_USER);
    await this.ensureStripePaymentLink(order.id, input.userId || SYSTEM_USER);
    return this.orderRepo.findOne({ where: { id: order.id } });
  }

  async linkOrderAndIssue(order: UpsellOrder, issue: Issue, userId: string) {
    if (order.issue_id !== issue.id) {
      order.issue_id = issue.id;
      await this.orderRepo.save(order);
    }
    if (issue.upsell_order_id !== order.id) {
      issue.upsell_order_id = order.id;
      await this.issueRepo.save(issue);
    }
    logger.info(
      `[UpsellBridge] linked order #${order.id} ↔ issue #${issue.id} by ${userId}`
    );
  }

  async ensureStripePaymentLink(orderId: number, userId: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) return null;
    if (order.payment_link) return order;

    const amount = Number(order.cost) || 0;
    if (!(amount > 0)) return order;

    const frontend = (process.env.FRONTEND_URL || "https://app.securestay.ai").replace(/\/$/, "");
    const successUrl = `${frontend}/luxury-lodging/upsells?paidOrder=${order.id}`;
    const cancelUrl = `${frontend}/luxury-lodging/upsells?cancelOrder=${order.id}`;

    try {
      const session = await this.stripeClient.createUpsellCheckoutSession({
        name: `${order.type || "Upsell"} — ${order.listing_name || order.listing_id || "Property"}`,
        price: amount,
        currency: "usd",
        successUrl,
        cancelUrl,
        clientReferenceId: `upsell_order_${order.id}`,
        metadata: {
          upsell_order_id: String(order.id),
          listing_id: String(order.listing_id || ""),
          booking_id: String(order.booking_id || ""),
        },
      });
      if (session.url) {
        order.payment_link = session.url;
        order.payment_method = order.payment_method || "Stripe";
        await this.orderRepo.save(order);
      }
    } catch (err: any) {
      logger.error(
        `[UpsellBridge] Stripe checkout failed for order #${orderId}: ${err?.message}`
      );
    }
    return order;
  }

  /**
   * When R&O becomes Paid: create a Resolution.
   * Amount = R&O cost; Amount to Payout = cost after 3% then PM%.
   * Ensures both categories exist: exact upsell name + "Upsell".
   * Resolution.category = upsell name; Resolution.type = "Upsell".
   */
  async createResolutionsForPaidOrder(order: UpsellOrder, userId: string) {
    if (!order?.id) return null;
    if (order.resolution_id) {
      return { skipped: true, resolutionId: order.resolution_id };
    }
    if (!["Paid", "Approved"].includes(String(order.status || "").trim())) {
      return null;
    }

    const amount = Number(order.cost) || 0;
    const { amountToPayout, pmFeePercent } = await this.computeAmountToPayout(
      amount,
      order.listing_id
    );

    const resolutionService = new ResolutionService();
    const upsellName = String(order.type || "Upsell").trim() || "Upsell";
    // Always keep both categories available in Resolutions.
    await resolutionService.ensureResolutionCategoryByName("Upsell");
    await resolutionService.ensureResolutionCategoryByName(upsellName);

    const primary = await resolutionService.createResolution(
      {
        category: upsellName,
        type: "Upsell",
        amount,
        amountToPayout,
        listingMapId: Number(order.listing_id) || null,
        reservationId: order.booking_id ? Number(order.booking_id) : null,
        guestName: order.client_name || null,
        claimDate: order.order_date
          ? String(order.order_date).slice(0, 10)
          : new Date().toISOString().slice(0, 10),
        arrivalDate: order.arrival_date || null,
        departureDate: order.departure_date || null,
        description: [
          `Upsell R&O #${order.id}: ${upsellName}`,
          `Guest charged $${amount.toFixed(2)}`,
          `Payout after 3% + ${pmFeePercent != null ? `${pmFeePercent}%` : "0%"} PM = $${amountToPayout.toFixed(2)}`,
          order.payment_link ? `Stripe: ${order.payment_link}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        creationSource: "upsell_order",
        llCover: false,
        fromPlus50: false,
        fromClaimsFee: false,
        deductFromRent: false,
      } as any,
      userId
    );

    order.resolution_id = primary.id;
    await this.orderRepo.save(order);
    logger.info(
      `[UpsellBridge] resolution #${primary.id} for order #${order.id}: amount=${amount} payout=${amountToPayout}`
    );
    return { primary, amount, amountToPayout, pmFeePercent };
  }

  async getLinkedIssueForOrder(orderId: number) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order?.issue_id) return { order, issue: null };
    const issue = await this.issueRepo.findOne({ where: { id: order.issue_id } });
    return { order, issue };
  }

  async getLinkedOrderForIssue(issueId: number) {
    const issue = await this.issueRepo.findOne({ where: { id: issueId } });
    if (!issue) return { issue: null, order: null };
    let order: UpsellOrder | null = null;
    if (issue.upsell_order_id) {
      order = await this.orderRepo.findOne({ where: { id: issue.upsell_order_id } });
    }
    if (!order) {
      order = await this.orderRepo.findOne({ where: { issue_id: issueId } });
      if (order && !issue.upsell_order_id) {
        issue.upsell_order_id = order.id;
        await this.issueRepo.save(issue);
      }
    }
    return { issue, order };
  }

  async syncIssueControlsFromOrder(
    orderId: number,
    controls: Partial<Pick<Issue, "status" | "gr_status" | "urgency" | "assignee" | "category">> & {
      due_date?: any;
    },
    userId: string
  ) {
    const { order, issue } = await this.getLinkedIssueForOrder(orderId);
    if (!order || !issue) throw new Error("No linked Guest Issue for this order");
    const issuesService = new IssuesService();
    return issuesService.updateIssue(issue.id, controls as any, userId);
  }

  async syncUpsellDetailsFromIssue(
    issueId: number,
    details: Partial<Pick<UpsellOrder, "status" | "cost" | "type" | "description" | "payment_method" | "payment_link">>,
    userId: string
  ) {
    const { order } = await this.getLinkedOrderForIssue(issueId);
    if (!order) throw new Error("No linked Upsell Request & Order for this issue");
    const orderService = new UpsellOrderService();
    return orderService.updateOrder(order.id, details as any, userId);
  }

  async postSharedDiscussion(input: {
    orderId?: number;
    issueId?: number;
    text: string;
    userId: string;
  }) {
    let issueId = input.issueId;
    if (!issueId && input.orderId) {
      const linked = await this.getLinkedIssueForOrder(input.orderId);
      issueId = linked.issue?.id;
      // Auto-create a Guest Issue shell if R&O has none yet.
      if (!issueId && linked.order) {
        const created = await this.ensureGuestIssueForOrder(linked.order, input.userId);
        issueId = created?.id;
      }
    }
    if (!issueId) throw new Error("No Guest Issue to attach discussion to");
    const issuesService = new IssuesService();
    return issuesService.createIssueUpdates(
      { issueId, updates: input.text, source: "securestay" },
      input.userId
    );
  }

  async ensureGuestIssueForOrder(order: UpsellOrder, userId: string) {
    if (order.issue_id) {
      return this.issueRepo.findOne({ where: { id: order.issue_id } });
    }
    const issuesService = new IssuesService();
    const issue = await issuesService.createIssue(
      {
        status: "New",
        gr_status: "New",
        listing_id: String(order.listing_id || "0"),
        listing_name: order.listing_name || null,
        reservation_id: order.booking_id || null,
        guest_name: order.client_name || null,
        guest_contact_number: order.phone || null,
        check_in_date: order.arrival_date || null,
        issue_description: `Upsell request: ${order.type}\n${order.description || ""}`.trim(),
        category: order.type || "Upsell",
        creator: userId,
        date_time_reported: new Date(),
        source: "upsell_order",
        upsell_order_id: order.id,
      } as any,
      userId
    );
    await this.linkOrderAndIssue(order, issue, userId);
    return issue;
  }

  /**
   * After a Guest Issue is auto-created from inbox, try to open matching R&O.
   */
  async maybeCreateOrderAfterIssueCreated(issue: Issue, userId = SYSTEM_USER) {
    try {
      return await this.autoCreateRequestOrderForIssue({ issue, userId });
    } catch (err: any) {
      logger.error(
        `[UpsellBridge] auto R&O after issue #${issue?.id} failed: ${err?.message}`
      );
      return null;
    }
  }
}
