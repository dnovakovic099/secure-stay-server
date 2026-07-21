import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { Listing } from "../entity/Listing";
import { AIMessagingSettingsEntity } from "../entity/AIMessagingSettings";
import { Hostify } from "../client/Hostify";
import sendEmail from "../utils/sendEmai";
import logger from "../utils/logger.utils";

/**
 * OverduePaymentService
 *
 * Two related jobs, both centred on non-Airbnb reservations (Airbnb collects the
 * money itself, so it never has an "overdue" balance for us):
 *
 *  1. Overdue Payments page — list reservations with their payment status
 *     (paid / partial / unpaid) and the outstanding balance, joined with the
 *     property owner + address for context.
 *
 *  2. "Guest needs to pay" emergency — when a guest on a non-Airbnb channel is
 *     arriving (or already staying) with an unpaid balance and messages us, we do
 *     NOT auto-answer. Instead we flag the conversation as an emergency (red
 *     banner in the inbox) and email the configured recipients so a human handles
 *     the payment before granting access.
 *
 * Payment status is sourced from Hostify (reservation.paid_part / paid_sum) and
 * persisted on reservation_info so the page reads our DB, with a sweep to refresh
 * the relevant window.
 */

export interface OverdueFilters {
    // "airbnb" is excluded by default; pass includeAirbnb to show everything.
    includeAirbnb?: boolean;
    channel?: string | null; // exact channelName/source filter
    payment?: "all" | "unpaid" | "partial" | "paid" | "unknown" | "owing";
    keyword?: string | null;
    listingId?: number | null;
    // Check-in date window (the primary way the page is filtered).
    checkinFrom?: string | null;
    checkinTo?: string | null;
    onlyArrived?: boolean; // only stays that have started (true overdue)
    // Blocked-calendar rows and $0 bookings are hidden unless this is set.
    includeJunk?: boolean;
    page?: number;
    perPage?: number;
    // "smart" (default): currently staying first, then soonest check-in,
    // past stays at the bottom.
    sortBy?: "smart" | "arrival" | "departure" | "due";
}

export interface OverdueRow {
    reservationId: number;
    confirmationCode: string | null;
    channel: string | null;
    source: string | null;
    isAirbnb: boolean;
    status: string | null;
    guestName: string | null;
    guestEmail: string | null;
    guestPhone: string | null;
    listingId: number | null;
    listingName: string | null;
    propertyAddress: string | null;
    ownerName: string | null;
    ownerEmail: string | null;
    ownerPhone: string | null;
    arrivalDate: string | null;
    departureDate: string | null;
    nights: number | null;
    currency: string | null;
    totalPrice: number | null;
    paidAmount: number | null;
    amountDue: number | null;
    // paid_sum / payout_price * 100 — the exact formula Hostify's own app uses
    // for its "Paid %" column (confirmed by Hostify support, Jul 2026).
    paidPercent: number | null;
    paidPart: string | null;
    paymentLabel: "paid" | "partial" | "unpaid" | "unknown";
    isOverdue: boolean;
    paymentSyncedAt: string | null;
}

export class OverduePaymentService {
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private conversationRepo = appDatabase.getRepository(InboxConversationEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private settingsRepo = appDatabase.getRepository(AIMessagingSettingsEntity);
    private hostify = new Hostify();
    private apiKey = process.env.HOSTIFY_API_KEY || "";

    // Reservation statuses that are not real, active bookings (cancelled, inquiry,
    // etc.). Mirrors ReservationInfoService.excludedStatus.
    private excludedStatus = [
        "cancelled", "canceled", "pending", "awaitingPayment", "declined", "expired", "inquiry",
        "inquiryPreapproved", "inquiryDenied", "inquiryTimedout", "inquiryNotPossible",
        "denied", "no_show", "awaiting_payment", "declined_inq", "preapproved", "offer",
        "withdrawn", "timedout", "not_possible", "deleted", "voided",
    ];

    private excludedStatusLower = new Set(this.excludedStatus.map((s) => s.toLowerCase()));

    /** Cancelled / inquiry / denied / etc. — never need a payment emergency. */
    private isInactiveReservationStatus(status?: string | null): boolean {
        const normalized = String(status || "")
            .trim()
            .toLowerCase()
            .replace(/[\s-]/g, "_");
        if (!normalized) return false;
        if (this.excludedStatusLower.has(normalized)) return true;
        // Hostify sometimes uses camelCase (awaitingPayment) or spaced labels.
        const compact = normalized.replace(/_/g, "");
        for (const s of this.excludedStatusLower) {
            if (s.replace(/_/g, "") === compact) return true;
        }
        return false;
    }

    static isAirbnb(source?: string | null, channelName?: string | null): boolean {
        const s = `${source || ""} ${channelName || ""}`.toLowerCase();
        return /airbnb/.test(s);
    }

    // Channels where the platform collects payment itself, so guests can never
    // be "overdue" — excluded from the list by default and never raise payment
    // emergencies. Currently Airbnb and HVMB.
    static isPaymentExempt(source?: string | null, channelName?: string | null): boolean {
        const s = `${source || ""} ${channelName || ""}`.toLowerCase();
        return /airbnb|hvmb/.test(s);
    }

    // Ozzie hotel (all child units): on Booking.com the guest pays lodging tax
    // directly to Booking.com, so Hostify often shows ~10–15% still "due".
    // At >= 85% collected we treat the stay as fully paid for our purposes.
    private static readonly OZZIE_BOOKING_COM_PAID_THRESHOLD = 0.85;

    static isBookingCom(source?: string | null, channelName?: string | null, listingName?: string | null): boolean {
        const s = `${source || ""} ${channelName || ""} ${listingName || ""}`.toLowerCase();
        return /booking\.com|\bbcom\b|\bbooking\b/.test(s);
    }

    /**
     * Ozzie hotel + every unit — matched via Hostify nickname ("… - Ozzie - …")
     * or owner contract name (Azhar "Ozzie" Pirzada).
     */
    static isOzzieProperty(listingName?: string | null, ownerName?: string | null): boolean {
        const haystack = `${listingName || ""} ${ownerName || ""}`;
        return /\bOzzie\b/i.test(haystack) || /Pirzada/i.test(ownerName || "");
    }

    /** Parse "paid 227.12 of 251.04" from an emergency reason — only useful as a ≥85% clear signal. */
    private paidRatioFromReason(reason?: string | null): { paid: number; total: number } | null {
        const m = String(reason || "").match(/paid\s+([\d.]+)\s+of\s+([\d.]+)/i);
        if (!m) return null;
        const paid = Number(m[1]);
        const total = Number(m[2]);
        if (!Number.isFinite(paid) || !Number.isFinite(total) || total <= 0) return null;
        return { paid, total };
    }

    private toNum(v: any): number | null {
        if (v === null || v === undefined || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    /**
     * Expected total for payment math: Hostify's payout_price (their own Paid %
     * denominator), falling back to totalPrice. Some Hostify records carry
     * payout_price = 0 (seen in prod) — treat that as missing, otherwise an
     * unpaid guest would show $0 due.
     */
    private expectedTotal(payoutPrice: any, totalPrice: any): number | null {
        const payout = this.toNum(payoutPrice);
        if (payout != null && payout > 0) return payout;
        return this.toNum(totalPrice);
    }

    /**
     * Normalize Hostify payment fields. UI "Paid" can come from paid_sum OR
     * total_paid depending on channel/integration — check both, plus due/balance.
     */
    private extractHostifyPayment(live: any): {
        paidPart: string | null;
        paid: number | null;
        total: number | null;
        due: number | null;
    } {
        const paidPart = live?.paid_part != null ? String(live.paid_part) : null;
        const paid =
            this.toNum(live?.paid_sum) ??
            this.toNum(live?.total_paid) ??
            this.toNum(live?.amount_paid) ??
            this.toNum(live?.paid) ??
            null;
        const total = this.expectedTotal(
            live?.payout_price,
            this.toNum(live?.total_price) ??
                this.toNum(live?.price) ??
                this.toNum(live?.payment) ??
                this.toNum(live?.revenue)
        );
        const due =
            this.toNum(live?.due) ??
            this.toNum(live?.balance) ??
            this.toNum(live?.amount_due) ??
            this.toNum(live?.remaining) ??
            (paid != null && total != null ? Math.max(0, total - paid) : null);
        return { paidPart, paid, total, due };
    }

    /** Fully paid if Hostify says full/all, or the collected amount covers the total. */
    private isFullyPaid(
        paidPart?: string | null,
        paid?: number | null,
        total?: number | null,
        ctx?: {
            source?: string | null;
            channelName?: string | null;
            listingName?: string | null;
            ownerName?: string | null;
            due?: number | null;
        }
    ): boolean {
        const pp = String(paidPart || "").toLowerCase();
        if (pp === "full" || pp === "all") return true;
        if (ctx?.due != null && ctx.due <= 0.5) return true;
        if (paid != null && total != null && total > 0 && paid + 0.5 >= total) return true;
        // Ozzie + Booking.com only: remaining balance is platform tax, not owed to us.
        if (
            ctx &&
            OverduePaymentService.isBookingCom(ctx.source, ctx.channelName, ctx.listingName) &&
            OverduePaymentService.isOzzieProperty(ctx.listingName, ctx.ownerName) &&
            paid != null &&
            total != null &&
            total > 0 &&
            paid / total >= OverduePaymentService.OZZIE_BOOKING_COM_PAID_THRESHOLD
        ) {
            return true;
        }
        return false;
    }

    /**
     * Clear stale payment pins (cancelled + Ozzie Booking.com ≥85%). Safe to call
     * from inbox list so pins drop without waiting for the 3-hour payment sweep.
     */
    async clearStalePaymentPins(): Promise<{ cleared: number }> {
        const cleared =
            (await this.clearPaymentEmergenciesForInactiveReservations()) +
            (await this.clearOzzieBookingComTaxRemainderEmergencies());
        return { cleared };
    }

    private paymentLabel(
        paidPart?: string | null,
        paid?: number | null,
        total?: number | null,
        ctx?: {
            source?: string | null;
            channelName?: string | null;
            listingName?: string | null;
            ownerName?: string | null;
        }
    ): OverdueRow["paymentLabel"] {
        const pp = String(paidPart || "").toLowerCase();
        if (this.isFullyPaid(paidPart, paid, total, ctx)) return "paid";
        // Hostify support describes paid_part as none/partial/full; the API has
        // historically returned "part" — accept both spellings.
        if (pp === "part" || pp === "partial" || (paid != null && paid > 0)) return "partial";
        if (pp === "none" || (paid != null && paid === 0)) return "unpaid";
        return paidPart ? "unpaid" : "unknown";
    }

    private todayStr(): string {
        return new Date().toISOString().slice(0, 10);
    }

    private dateStr(d: any): string | null {
        if (!d) return null;
        try {
            return new Date(d).toISOString().slice(0, 10);
        } catch {
            return typeof d === "string" ? d.slice(0, 10) : null;
        }
    }

    // -------------------------------------------------------------------------
    // Overdue Payments listing
    // -------------------------------------------------------------------------
    async listOverdue(filters: OverdueFilters = {}): Promise<{
        rows: OverdueRow[];
        total: number;
        page: number;
        perPage: number;
        totals: { count: number; totalDue: number; currency: string | null };
        channels: string[];
    }> {
        const page = Math.max(filters.page ?? 1, 1);
        const perPage = Math.min(Math.max(filters.perPage ?? 25, 1), 200);
        const today = this.todayStr();

        const qb = this.reservationRepo
            .createQueryBuilder("r")
            .where("r.status NOT IN (:...excluded)", { excluded: this.excludedStatus });

        // Airbnb and HVMB collect payment themselves, so they're excluded by
        // default; a specific channel filter overrides that.
        if (filters.channel) {
            qb.andWhere("(r.channelName = :ch OR r.source = :ch)", { ch: filters.channel });
        } else if (!filters.includeAirbnb) {
            qb.andWhere(
                "(COALESCE(r.source,'') NOT LIKE '%airbnb%' AND COALESCE(r.channelName,'') NOT LIKE '%airbnb%'" +
                " AND COALESCE(r.source,'') NOT LIKE '%hvmb%' AND COALESCE(r.channelName,'') NOT LIKE '%hvmb%')"
            );
        }

        // Hide calendar-block pseudo-reservations and $0 bookings by default —
        // nothing is owed on them, they just bury the real arrivals.
        if (!filters.includeJunk) {
            // payout_price can be 0 on some Hostify records; fall back to totalPrice.
            qb.andWhere("COALESCE(IF(COALESCE(r.payoutPrice, 0) > 0, r.payoutPrice, r.totalPrice), 0) > 0");
            qb.andWhere("LOWER(COALESCE(r.guestName,'')) NOT IN ('blocked', 'airbnb (not available)', 'not available')");
        }

        if (filters.listingId) qb.andWhere("r.listingMapId = :lid", { lid: filters.listingId });
        if (filters.checkinFrom) qb.andWhere("r.arrivalDate >= :cf", { cf: filters.checkinFrom });
        if (filters.checkinTo) qb.andWhere("r.arrivalDate <= :ct", { ct: filters.checkinTo });
        if (filters.keyword) {
            const kw = `%${filters.keyword.trim()}%`;
            qb.andWhere(
                "(r.guestName LIKE :kw OR r.guestEmail LIKE :kw OR r.phone LIKE :kw OR r.listingName LIKE :kw OR r.confirmation_code LIKE :kw)",
                { kw }
            );
        }

        // Payment filter mapped to persisted paidPart/paidAmount.
        switch (filters.payment) {
            case "paid":
                qb.andWhere("LOWER(COALESCE(r.paidPart,'')) IN ('full','all')");
                break;
            case "partial":
                qb.andWhere("LOWER(COALESCE(r.paidPart,'')) IN ('part','partial')");
                break;
            case "unpaid":
                qb.andWhere("LOWER(COALESCE(r.paidPart,'')) = 'none'");
                break;
            case "owing":
                qb.andWhere("LOWER(COALESCE(r.paidPart,'')) IN ('none','part','partial')");
                break;
            case "unknown":
                qb.andWhere("r.paidPart IS NULL");
                break;
            case "all":
            default:
                // no payment filter
                break;
        }

        // Ordering. "smart" (default) surfaces who matters NOW: guests currently
        // in-house first, then upcoming check-ins soonest-first, and stays that
        // already ended at the bottom (most recent first).
        qb.setParameter("todayD", today);
        switch (filters.sortBy) {
            case "arrival":
                qb.orderBy("r.arrivalDate", "ASC");
                break;
            case "departure":
                qb.orderBy("r.departureDate", "ASC");
                break;
            case "due":
                qb.orderBy(
                    "(COALESCE(IF(COALESCE(r.payoutPrice, 0) > 0, r.payoutPrice, r.totalPrice), 0) - COALESCE(r.paidAmount, 0))",
                    "DESC"
                );
                break;
            case "smart":
            default:
                qb.orderBy(
                    `CASE
                        WHEN r.departureDate IS NOT NULL AND r.departureDate < :todayD THEN 2
                        WHEN r.arrivalDate IS NOT NULL AND r.arrivalDate <= :todayD THEN 0
                        ELSE 1
                    END`,
                    "ASC"
                ).addOrderBy("ABS(DATEDIFF(r.arrivalDate, :todayD))", "ASC");
                break;
        }
        qb.skip((page - 1) * perPage).take(perPage);

        const [reservations, total] = await qb.getManyAndCount();

        // Distinct channels for the filter dropdown (cheap, index-friendly).
        const channelRows: { ch: string }[] = await this.reservationRepo
            .createQueryBuilder("r")
            .select("DISTINCT r.channelName", "ch")
            .where("r.channelName IS NOT NULL AND r.channelName != ''")
            .getRawMany();
        const channels = channelRows.map((c) => c.ch).filter(Boolean).sort();

        const listingIds = Array.from(
            new Set(reservations.map((r) => Number(r.listingMapId)).filter((id) => Number.isFinite(id) && id > 0))
        );
        const listings = listingIds.length
            ? await this.listingRepo.find({ where: { id: In(listingIds) }, withDeleted: true })
            : [];
        const listingMap = new Map(listings.map((l) => [Number(l.id), l]));

        const rows: OverdueRow[] = reservations.map((r) => {
            const listing = listingMap.get(Number(r.listingMapId)) || null;
            // Hostify's own "Paid %" divides paid_sum by payout_price, so when we
            // have payout_price it is the expected total; totalPrice
            // (subtotal + tax) is only the fallback for unsynced rows.
            const total = this.expectedTotal(r.payoutPrice, r.totalPrice);
            const paid = this.toNum(r.paidAmount);
            const listingName = r.listingName || listing?.internalListingName || null;
            const payCtx = {
                source: r.source,
                channelName: r.channelName,
                listingName,
                ownerName: listing?.ownerName || null,
            };
            const label = this.paymentLabel(r.paidPart, paid, total, payCtx);
            // Ozzie Booking.com tax remainder is not owed to us — show $0 due once paid enough.
            const due =
                label === "paid"
                    ? 0
                    : total != null
                      ? Math.max(0, total - (paid ?? 0))
                      : null;
            const paidPercent =
                total != null && total > 0 && paid != null
                    ? Math.round(Math.min(Math.max((paid / total) * 100, 0), 999) * 10) / 10
                    : null;
            const arrival = this.dateStr(r.arrivalDate);
            const departure = this.dateStr(r.departureDate);
            const arrived = arrival != null && arrival <= today;
            const address = listing
                ? [listing.address, listing.city, listing.state, listing.zipcode].filter(Boolean).join(", ") || listing.address || null
                : null;
            return {
                reservationId: r.id,
                confirmationCode: r.confirmation_code || null,
                channel: r.channelName || null,
                source: r.source || null,
                isAirbnb: OverduePaymentService.isAirbnb(r.source, r.channelName),
                status: r.status || null,
                guestName: r.guestName || null,
                guestEmail: r.guestEmail || null,
                guestPhone: r.phone || null,
                listingId: r.listingMapId || null,
                listingName,
                propertyAddress: address,
                ownerName: listing?.ownerName || null,
                ownerEmail: listing?.ownerEmail || null,
                ownerPhone: listing?.ownerPhone || null,
                arrivalDate: arrival,
                departureDate: departure,
                nights: r.nights ?? null,
                currency: r.currency || null,
                totalPrice: total,
                paidAmount: paid,
                amountDue: due,
                paidPercent,
                paidPart: r.paidPart || null,
                paymentLabel: label,
                isOverdue: arrived && label !== "paid",
                paymentSyncedAt: r.paymentSyncedAt ? new Date(r.paymentSyncedAt).toISOString() : null,
            };
        });

        const filteredForOverdue = filters.onlyArrived ? rows.filter((row) => row.isOverdue) : rows;
        const totalDue = filteredForOverdue.reduce((sum, row) => sum + (row.amountDue ?? 0), 0);
        const currency = rows.find((row) => row.currency)?.currency || null;

        return {
            rows: filters.onlyArrived ? filteredForOverdue : rows,
            total: filters.onlyArrived ? filteredForOverdue.length : total,
            page,
            perPage,
            totals: { count: filteredForOverdue.length, totalDue, currency },
            channels,
        };
    }

    // -------------------------------------------------------------------------
    // Payment sweep — refresh paid_part/paid_sum from Hostify for the relevant
    // window (non-Airbnb, active, current+upcoming+recent). Bounded so we never
    // hammer the API. Also clears any stale payment emergency once fully paid.
    // -------------------------------------------------------------------------
    async syncPaymentStatus(opts: { lookbackDays?: number; lookaheadDays?: number; limit?: number } = {}): Promise<{
        checked: number;
        updated: number;
        emergenciesRaised: number;
        emergenciesCleared: number;
    }> {
        // Local-only: drop stale payment pins on cancelled/inactive reservations
        // and Ozzie Booking.com tax-remainder cases, even when Hostify sync can't run.
        let emergenciesCleared =
            (await this.clearPaymentEmergenciesForInactiveReservations()) +
            (await this.clearOzzieBookingComTaxRemainderEmergencies());

        if (!this.apiKey) {
            logger.warn("[OverduePayment] No Hostify API key configured; skipping payment sweep");
            return { checked: 0, updated: 0, emergenciesRaised: 0, emergenciesCleared };
        }
        const lookback = opts.lookbackDays ?? 21;
        const lookahead = opts.lookaheadDays ?? 120;
        const limit = opts.limit ?? 400;

        const from = new Date();
        from.setDate(from.getDate() - lookback);
        const to = new Date();
        to.setDate(to.getDate() + lookahead);
        const fromStr = from.toISOString().slice(0, 10);
        const toStr = to.toISOString().slice(0, 10);

        const qb = this.reservationRepo
            .createQueryBuilder("r")
            .where("r.status NOT IN (:...excluded)", { excluded: this.excludedStatus })
            .andWhere(
                "(COALESCE(r.source,'') NOT LIKE '%airbnb%' AND COALESCE(r.channelName,'') NOT LIKE '%airbnb%'" +
                " AND COALESCE(r.source,'') NOT LIKE '%hvmb%' AND COALESCE(r.channelName,'') NOT LIKE '%hvmb%')"
            )
            .andWhere("(r.departureDate IS NULL OR r.departureDate >= :fromStr)", { fromStr })
            .andWhere("(r.arrivalDate IS NULL OR r.arrivalDate <= :toStr)", { toStr })
            .orderBy("r.arrivalDate", "ASC")
            .take(limit);

        const reservations = await qb.getMany();
        let checked = 0;
        let updated = 0;
        let emergenciesRaised = 0;

        const listingIds = Array.from(
            new Set(reservations.map((r) => Number(r.listingMapId)).filter((id) => Number.isFinite(id) && id > 0))
        );
        const listings = listingIds.length
            ? await this.listingRepo.find({ where: { id: In(listingIds) }, withDeleted: true })
            : [];
        const listingById = new Map(listings.map((l) => [Number(l.id), l]));

        const today = this.todayStr();
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrow = tomorrowDate.toISOString().slice(0, 10);

        for (const r of reservations) {
            checked++;
            try {
                const data: any = await this.hostify.getReservationInfo(this.apiKey, r.id);
                const live = data?.reservation || {};

                // Hostify may have cancelled since our last local status sync.
                const liveStatus = live.status != null ? String(live.status) : null;
                if (liveStatus) {
                    r.status = liveStatus;
                    if (this.isInactiveReservationStatus(liveStatus)) {
                        await this.reservationRepo.save(r);
                        updated++;
                        const cleared = await this.clearEmergencyForReservation(r.id, "payment");
                        if (cleared) emergenciesCleared++;
                        continue;
                    }
                }

                const extracted = this.extractHostifyPayment(live);
                const payoutPrice = this.toNum(live.payout_price);
                if (extracted.paidPart == null && extracted.paid == null && payoutPrice == null) continue;

                r.paidPart = extracted.paidPart ?? r.paidPart;
                if (extracted.paid != null) r.paidAmount = extracted.paid;
                if (payoutPrice != null) r.payoutPrice = payoutPrice;
                r.paymentSyncedAt = new Date();
                await this.reservationRepo.save(r);
                updated++;

                const expectedTotal = extracted.total ?? this.expectedTotal(r.payoutPrice, r.totalPrice);
                const listing = r.listingMapId != null ? listingById.get(Number(r.listingMapId)) || null : null;
                const payCtx = {
                    source: r.source,
                    channelName: r.channelName,
                    listingName: r.listingName || listing?.internalListingName || null,
                    ownerName: listing?.ownerName || null,
                    due: extracted.due,
                };
                const fullyPaid = this.isFullyPaid(r.paidPart, r.paidAmount, expectedTotal, payCtx);

                // Clear a payment emergency once the balance is settled.
                if (fullyPaid) {
                    const cleared = await this.clearEmergencyForReservation(r.id, "payment");
                    if (cleared) emergenciesCleared++;
                    continue;
                }

                // Proactively raise the emergency (no guest message needed) when
                // an unpaid guest checks in today or tomorrow, so the conversation
                // is pinned in the inbox and the alert email goes out ahead of
                // arrival instead of only when the guest happens to write in.
                const arrival = this.dateStr(r.arrivalDate);
                if (arrival === today || arrival === tomorrow) {
                    const raised = await this.raiseEmergencyForReservation(r, payCtx);
                    if (raised) emergenciesRaised++;
                }
            } catch (err: any) {
                logger.warn(`[OverduePayment] sweep failed for reservation ${r.id}: ${err.message}`);
            }
        }

        logger.info(
            `[OverduePayment] Sweep — checked=${checked}, updated=${updated}, emergenciesRaised=${emergenciesRaised}, emergenciesCleared=${emergenciesCleared}`
        );
        return { checked, updated, emergenciesRaised, emergenciesCleared };
    }

    /**
     * Raise the "guest needs to pay" emergency for a reservation's conversation
     * during the sweep. Returns true only on a fresh raise (email sent).
     */
    private async raiseEmergencyForReservation(
        r: ReservationInfoEntity,
        payCtx?: {
            source?: string | null;
            channelName?: string | null;
            listingName?: string | null;
            ownerName?: string | null;
        }
    ): Promise<boolean> {
        if (this.isInactiveReservationStatus(r.status)) return false;
        const conversation = await this.conversationRepo.findOne({ where: { reservationId: r.id } });
        if (!conversation) return false;
        if (this.isInactiveReservationStatus(conversation.reservationStatus)) return false;
        if (Number(conversation.emergency) === 1 && conversation.emergencyType === "payment") return false;

        const total = this.expectedTotal(r.payoutPrice, r.totalPrice);
        const paid = this.toNum(r.paidAmount);
        if (this.isFullyPaid(r.paidPart, paid, total, payCtx)) return false;
        const due = total != null ? Math.max(0, total - (paid ?? 0)) : null;
        const money = due != null
            ? `${due.toFixed(2)}${r.currency ? " " + r.currency : ""} still due`
            : "an outstanding balance";
        const arrival = this.dateStr(r.arrivalDate);
        const reason = `Guest checks in ${arrival === this.todayStr() ? "TODAY" : `on ${arrival}`} via ${r.channelName || r.source || "a non-Airbnb channel"} with ${money} (paid ${paid != null ? paid.toFixed(2) : "0"}${total != null ? " of " + total.toFixed(2) : ""}). Do not grant access until paid.`;
        return this.raiseEmergency(conversation, reason, "payment");
    }

    // -------------------------------------------------------------------------
    // "Guest needs to pay" emergency
    // -------------------------------------------------------------------------

    /**
     * Decide whether an inbound message on this conversation should trigger the
     * unpaid-arrival emergency. Uses the live Hostify reservation so the decision
     * is accurate at message time, and persists the payment status while here.
     */
    async evaluateArrivalPaymentEmergency(conversation: InboxConversationEntity): Promise<{
        isEmergency: boolean;
        reason: string | null;
    }> {
        try {
            if (!conversation?.reservationId || !this.apiKey) return { isEmergency: false, reason: null };
            if (OverduePaymentService.isPaymentExempt(null, conversation.channel)) return { isEmergency: false, reason: null };

            const reservationId = Number(conversation.reservationId);
            const data: any = await this.hostify.getReservationInfo(this.apiKey, reservationId);
            const r = data?.reservation || {};
            if (!r || Object.keys(r).length === 0) return { isEmergency: false, reason: null };

            const status = String(r.status || "");
            if (this.isInactiveReservationStatus(status) || this.isInactiveReservationStatus(conversation.reservationStatus)) {
                // Stale pin from before cancel/decline — drop it.
                await this.clearEmergencyForReservation(reservationId, "payment");
                return { isEmergency: false, reason: null };
            }
            // Double-check channel/source from the live record too.
            if (OverduePaymentService.isPaymentExempt(r.source, r.channel_name || r.integration_name)) {
                return { isEmergency: false, reason: null };
            }

            const extracted = this.extractHostifyPayment(r);
            const payoutPrice = this.toNum(r.payout_price);
            let total = extracted.total;
            if (total == null) {
                const subtotal = this.toNum(r.subtotal);
                const tax = this.toNum(r.tax_amount);
                total =
                    payoutPrice != null && payoutPrice > 0
                        ? payoutPrice
                        : subtotal != null
                          ? subtotal + (tax ?? 0)
                          : this.toNum(r.total_price);
            }
            if (total == null) {
                const stored = await this.reservationRepo.findOne({ where: { id: reservationId } });
                total = this.expectedTotal(stored?.payoutPrice, stored?.totalPrice);
            }
            const paidSum = extracted.paid;
            const paidPart = extracted.paidPart;

            // Persist what we learned regardless of the emergency outcome.
            try {
                await this.reservationRepo.update(
                    { id: reservationId },
                    {
                        paidPart: paidPart ?? undefined,
                        paidAmount: paidSum ?? undefined,
                        payoutPrice: payoutPrice ?? undefined,
                        paymentSyncedAt: new Date(),
                    }
                );
            } catch {
                /* best-effort */
            }

            const listingId = Number(conversation.listingId || r.listing_id || 0) || null;
            const listing = listingId
                ? await this.listingRepo.findOne({ where: { id: listingId }, withDeleted: true })
                : null;
            const stored = !listing
                ? await this.reservationRepo.findOne({ where: { id: reservationId } })
                : null;
            const payCtx = {
                source: r.source || stored?.source || null,
                channelName: r.channel_name || r.integration_name || conversation.channel || stored?.channelName || null,
                listingName:
                    conversation.listingName ||
                    listing?.internalListingName ||
                    stored?.listingName ||
                    r.listing_name ||
                    null,
                ownerName: listing?.ownerName || null,
                due: extracted.due,
            };

            if (this.isFullyPaid(paidPart, paidSum, total, payCtx)) {
                // Clear stale pins once Ozzie Booking.com tax remainder (or full pay) is satisfied.
                await this.clearEmergencyForReservation(reservationId, "payment");
                return { isEmergency: false, reason: null };
            }

            const arrival = this.dateStr(r.checkIn || r.arrivalDate);
            const departure = this.dateStr(r.checkOut || r.departureDate);
            const today = this.todayStr();
            const tomorrowDate = new Date();
            tomorrowDate.setDate(tomorrowDate.getDate() + 1);
            const tomorrow = tomorrowDate.toISOString().slice(0, 10);
            // Trigger when the guest arrives today or tomorrow — or if they should
            // already have arrived and the stay is still active — with a balance due.
            const arrivingOrStaying = arrival != null && arrival <= tomorrow && (departure == null || departure >= today);
            if (!arrivingOrStaying) return { isEmergency: false, reason: null };

            const due = extracted.due ?? (total != null ? Math.max(0, total - (paidSum ?? 0)) : null);
            const money = due != null
                ? `${due.toFixed(2)}${r.currency ? " " + r.currency : ""} still due`
                : "an outstanding balance";
            const reason = `Guest is arriving ${arrival} on ${conversation.channel || "a non-Airbnb channel"} with ${money} (paid ${paidSum != null ? paidSum.toFixed(2) : "0"}${total != null ? " of " + total.toFixed(2) : ""}). Do not grant access until paid.`;
            return { isEmergency: true, reason };
        } catch (err: any) {
            logger.warn(`[OverduePayment] emergency eval failed for thread ${conversation?.threadId}: ${err.message}`);
            return { isEmergency: false, reason: null };
        }
    }

    /**
     * Flag the conversation as urgent (inbox pin + AI pause).
     * Payment emergencies email alert recipients; other types (e.g. extension_price)
     * are inbox-only unless opts.notify is true.
     */
    async raiseEmergency(
        conversation: InboxConversationEntity,
        reason: string,
        type = "payment",
        opts: { notify?: boolean } = {}
    ): Promise<boolean> {
        // Cancelled / inquiry / etc. never need a payment pin.
        if (type === "payment" && this.isInactiveReservationStatus(conversation.reservationStatus)) {
            return false;
        }
        // Never downgrade a payment emergency to a softer type.
        if (
            Number(conversation.emergency) === 1 &&
            conversation.emergencyType === "payment" &&
            type !== "payment"
        ) {
            return false;
        }
        const wasSame = Number(conversation.emergency) === 1 && conversation.emergencyType === type;
        conversation.emergency = 1;
        conversation.emergencyType = type;
        conversation.emergencyReason = reason ? reason.slice(0, 500) : null;
        if (!wasSame) conversation.emergencyAt = new Date();
        await this.conversationRepo.save(conversation);

        const shouldNotify = opts.notify !== undefined ? opts.notify : type === "payment";
        if (!wasSame && shouldNotify) {
            await this.sendEmergencyEmail(conversation, reason).catch((e) =>
                logger.error(`[OverduePayment] emergency email failed for thread ${conversation.threadId}: ${e.message}`)
            );
        }
        return !wasSame;
    }

    async clearEmergency(threadId: number): Promise<boolean> {
        const conversation = await this.conversationRepo.findOne({ where: { threadId } });
        if (!conversation || Number(conversation.emergency) !== 1) return false;
        conversation.emergency = 0;
        conversation.emergencyType = null;
        conversation.emergencyReason = null;
        conversation.emergencyAt = null;
        await this.conversationRepo.save(conversation);
        return true;
    }

    private async clearEmergencyForReservation(reservationId: number, type: string): Promise<boolean> {
        const conversation = await this.conversationRepo.findOne({ where: { reservationId } });
        if (!conversation || Number(conversation.emergency) !== 1 || conversation.emergencyType !== type) return false;
        conversation.emergency = 0;
        conversation.emergencyType = null;
        conversation.emergencyReason = null;
        conversation.emergencyAt = null;
        await this.conversationRepo.save(conversation);
        return true;
    }

    /**
     * Ozzie + Booking.com: once Hostify shows paid (full / due≈0 / ≥85%), clear
     * leftover "needs payment" pins. Always re-fetches live Hostify — never trust
     * a stale raise-time "paid 0.00 of …" snapshot to keep the pin.
     */
    private async clearOzzieBookingComTaxRemainderEmergencies(): Promise<number> {
        try {
            const pinned = await this.conversationRepo
                .createQueryBuilder("c")
                .select([
                    "c.threadId",
                    "c.reservationId",
                    "c.listingName",
                    "c.channel",
                    "c.emergencyReason",
                    "c.emergencyType",
                ])
                .where("c.emergency = 1")
                .andWhere("(c.emergencyType = :type OR c.emergencyType IS NULL OR c.emergencyType = '')", {
                    type: "payment",
                })
                .getMany();
            if (!pinned.length) return 0;

            const reservationIds = pinned
                .map((c) => Number(c.reservationId))
                .filter((id) => Number.isFinite(id) && id > 0);
            const reservations = reservationIds.length
                ? await this.reservationRepo.find({ where: { id: In(reservationIds) } })
                : [];
            const reservationById = new Map(reservations.map((r) => [Number(r.id), r]));
            const listingIds = Array.from(
                new Set(reservations.map((r) => Number(r.listingMapId)).filter((id) => Number.isFinite(id) && id > 0))
            );
            const listings = listingIds.length
                ? await this.listingRepo.find({ where: { id: In(listingIds) }, withDeleted: true })
                : [];
            const listingById = new Map(listings.map((l) => [Number(l.id), l]));

            let cleared = 0;
            for (const conversation of pinned) {
                const reservation = conversation.reservationId
                    ? reservationById.get(Number(conversation.reservationId))
                    : null;
                const listing =
                    reservation?.listingMapId != null
                        ? listingById.get(Number(reservation.listingMapId)) || null
                        : null;
                const payCtx: {
                    source?: string | null;
                    channelName?: string | null;
                    listingName?: string | null;
                    ownerName?: string | null;
                    due?: number | null;
                } = {
                    source: reservation?.source || null,
                    channelName: reservation?.channelName || conversation.channel,
                    listingName:
                        reservation?.listingName ||
                        listing?.internalListingName ||
                        conversation.listingName ||
                        null,
                    ownerName: listing?.ownerName || null,
                };
                if (
                    !OverduePaymentService.isBookingCom(payCtx.source, payCtx.channelName, payCtx.listingName) ||
                    !OverduePaymentService.isOzzieProperty(payCtx.listingName, payCtx.ownerName)
                ) {
                    continue;
                }

                let paidPart = reservation?.paidPart ?? null;
                let paid = this.toNum(reservation?.paidAmount);
                let total = this.expectedTotal(reservation?.payoutPrice, reservation?.totalPrice);
                let qualifies = false;

                // Always prefer live Hostify for Ozzie B.com — local/reason snapshots go stale.
                if (this.apiKey && conversation.reservationId) {
                    try {
                        const data: any = await this.hostify.getReservationInfo(
                            this.apiKey,
                            Number(conversation.reservationId)
                        );
                        const live = data?.reservation || data || {};
                        const extracted = this.extractHostifyPayment(live);
                        paidPart = extracted.paidPart ?? paidPart;
                        paid = extracted.paid ?? paid;
                        total = extracted.total ?? total;
                        payCtx.due = extracted.due;
                        qualifies = this.isFullyPaid(paidPart, paid, total, payCtx);
                        if (reservation) {
                            reservation.paidPart = paidPart ?? reservation.paidPart;
                            if (paid != null) reservation.paidAmount = paid;
                            const payout = this.toNum(live.payout_price);
                            if (payout != null) reservation.payoutPrice = payout;
                            reservation.paymentSyncedAt = new Date();
                            await this.reservationRepo.save(reservation);
                        }
                        logger.info(
                            `[OverduePayment] Ozzie B.com live check thread=${conversation.threadId} res=${conversation.reservationId} paidPart=${paidPart} paid=${paid} total=${total} due=${extracted.due} qualifies=${qualifies}`
                        );
                    } catch (err: any) {
                        logger.warn(
                            `[OverduePayment] Ozzie B.com live check failed for reservation ${conversation.reservationId}: ${err.message}`
                        );
                    }
                }

                // Offline / API failure fallback: reason snapshot only if it already shows ≥85%.
                if (!qualifies) {
                    const fromReason = this.paidRatioFromReason(conversation.emergencyReason);
                    if (
                        fromReason &&
                        fromReason.paid / fromReason.total >= OverduePaymentService.OZZIE_BOOKING_COM_PAID_THRESHOLD
                    ) {
                        qualifies = true;
                    } else {
                        qualifies = this.isFullyPaid(paidPart, paid, total, payCtx);
                    }
                }

                if (!qualifies) continue;
                const ok = await this.clearEmergency(Number(conversation.threadId));
                if (ok) cleared++;
            }
            if (cleared > 0) {
                logger.info(
                    `[OverduePayment] Cleared ${cleared} Ozzie Booking.com payment emergency(ies) (live Hostify paid / ≥85%)`
                );
            }
            return cleared;
        } catch (err: any) {
            logger.warn(`[OverduePayment] clearOzzieBookingComTaxRemainderEmergencies failed: ${err.message}`);
            return 0;
        }
    }

    /**
     * Drop "needs payment" pins on cancelled / inactive reservations. These are
     * skipped by the active-reservation Hostify sweep, so without this they
     * linger in the inbox forever after cancel.
     */
    private async clearPaymentEmergenciesForInactiveReservations(): Promise<number> {
        try {
            const pinned = await this.conversationRepo.find({
                where: { emergency: 1, emergencyType: "payment" },
                select: ["threadId", "reservationId", "reservationStatus"],
            });
            if (!pinned.length) return 0;

            const reservationIds = pinned
                .map((c) => Number(c.reservationId))
                .filter((id) => Number.isFinite(id) && id > 0);
            const reservations = reservationIds.length
                ? await this.reservationRepo.find({
                      where: { id: In(reservationIds) },
                      select: ["id", "status"],
                  })
                : [];
            const statusByReservationId = new Map(reservations.map((r) => [Number(r.id), r.status]));

            let cleared = 0;
            for (const conversation of pinned) {
                const reservationStatus = conversation.reservationId
                    ? statusByReservationId.get(Number(conversation.reservationId))
                    : null;
                const status = reservationStatus || conversation.reservationStatus;
                if (!this.isInactiveReservationStatus(status)) continue;
                const ok = await this.clearEmergency(Number(conversation.threadId));
                if (ok) cleared++;
            }
            if (cleared > 0) {
                logger.info(`[OverduePayment] Cleared ${cleared} payment emergency(ies) on inactive/cancelled reservations`);
            }
            return cleared;
        } catch (err: any) {
            logger.warn(`[OverduePayment] clearPaymentEmergenciesForInactiveReservations failed: ${err.message}`);
            return 0;
        }
    }

    async getAlertRecipients(): Promise<string[]> {
        try {
            const settings = await this.settingsRepo.findOne({ where: { listingId: null as any } });
            const raw = settings?.paymentAlertEmails || "";
            const list = raw
                .split(/[\s,;]+/)
                .map((s) => s.trim())
                .filter((s) => /.+@.+\..+/.test(s));
            if (list.length) return Array.from(new Set(list));
        } catch (err: any) {
            logger.warn(`[OverduePayment] failed to read alert recipients: ${err.message}`);
        }
        const fallback = process.env.EMAIL_TO;
        return fallback ? [fallback] : [];
    }

    private async sendEmergencyEmail(conversation: InboxConversationEntity, reason: string): Promise<void> {
        const recipients = await this.getAlertRecipients();
        if (!recipients.length) {
            logger.warn("[OverduePayment] no payment-alert recipients configured; skipping email");
            return;
        }
        const dashboardUrl = process.env.DASHBOARD_URL || process.env.FRONTEND_URL || "";
        const threadLink = dashboardUrl ? `${dashboardUrl.replace(/\/$/, "")}/messages/inbox-v2?thread=${conversation.threadId}` : "";
        const subject = `⚠️ Payment needed before check-in — ${conversation.guestName || "Guest"}${conversation.listingName ? " · " + conversation.listingName : ""}`;
        const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5">
        <h2 style="color:#b91c1c;margin:0 0 12px">Guest needs to pay</h2>
        <p>${reason}</p>
        <table style="border-collapse:collapse;margin:12px 0">
          <tr><td style="padding:2px 12px 2px 0;color:#555">Guest</td><td><strong>${conversation.guestName || "—"}</strong></td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#555">Property</td><td>${conversation.listingName || "—"}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#555">Channel</td><td>${conversation.channel || "—"}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#555">Check-in</td><td>${conversation.checkin || "—"}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#555">Contact</td><td>${[conversation.guestPhone, conversation.guestEmail].filter(Boolean).join(" · ") || "—"}</td></tr>
        </table>
        <p style="color:#b91c1c"><strong>The AI assistant has been paused for this conversation.</strong> Please contact the guest to collect payment before granting access.</p>
        ${threadLink ? `<p><a href="${threadLink}" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open conversation</a></p>` : ""}
      </div>`;
        const from = process.env.EMAIL_FROM;
        await Promise.allSettled(recipients.map((to) => sendEmail(subject, html, from, to)));
        logger.info(`[OverduePayment] payment emergency email sent to ${recipients.length} recipient(s) for thread ${conversation.threadId}`);
    }
}
