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
    channel?: string | null; // exact channelName filter (overrides the airbnb default)
    payment?: "all" | "unpaid" | "partial" | "paid" | "unknown";
    keyword?: string | null;
    listingId?: number | null;
    // Only reservations departing on/after this date are shown (defaults to 30
    // days ago so we keep the list to current + recent + upcoming).
    fromDate?: string | null;
    toDate?: string | null; // filter on arrival date upper bound
    onlyArrived?: boolean; // only stays that have started (true overdue)
    page?: number;
    perPage?: number;
    sortBy?: "arrival" | "departure" | "due";
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
        "cancelled", "pending", "awaitingPayment", "declined", "expired", "inquiry",
        "inquiryPreapproved", "inquiryDenied", "inquiryTimedout", "inquiryNotPossible",
        "denied", "no_show", "awaiting_payment", "declined_inq", "preapproved", "offer",
        "withdrawn", "timedout", "not_possible", "deleted", "voided",
    ];

    static isAirbnb(source?: string | null, channelName?: string | null): boolean {
        const s = `${source || ""} ${channelName || ""}`.toLowerCase();
        return /airbnb/.test(s);
    }

    private toNum(v: any): number | null {
        if (v === null || v === undefined || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    /** Fully paid if Hostify says full/all, or the collected amount covers the total. */
    private isFullyPaid(paidPart?: string | null, paid?: number | null, total?: number | null): boolean {
        const pp = String(paidPart || "").toLowerCase();
        if (pp === "full" || pp === "all") return true;
        if (paid != null && total != null && total > 0 && paid + 0.5 >= total) return true;
        return false;
    }

    private paymentLabel(paidPart?: string | null, paid?: number | null, total?: number | null): OverdueRow["paymentLabel"] {
        const pp = String(paidPart || "").toLowerCase();
        if (this.isFullyPaid(paidPart, paid, total)) return "paid";
        if (pp === "part" || (paid != null && paid > 0)) return "partial";
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
    }> {
        const page = Math.max(filters.page ?? 1, 1);
        const perPage = Math.min(Math.max(filters.perPage ?? 25, 1), 200);
        const fromDate = filters.fromDate || (() => {
            const d = new Date();
            d.setDate(d.getDate() - 30);
            return d.toISOString().slice(0, 10);
        })();

        const qb = this.reservationRepo
            .createQueryBuilder("r")
            .where("r.status NOT IN (:...excluded)", { excluded: this.excludedStatus });

        // Non-Airbnb by default; a specific channel filter overrides that.
        if (filters.channel) {
            qb.andWhere("(r.channelName = :ch OR r.source = :ch)", { ch: filters.channel });
        } else if (!filters.includeAirbnb) {
            qb.andWhere("(COALESCE(r.source,'') NOT LIKE '%airbnb%' AND COALESCE(r.channelName,'') NOT LIKE '%airbnb%')");
        }

        if (filters.listingId) qb.andWhere("r.listingMapId = :lid", { lid: filters.listingId });
        if (fromDate) qb.andWhere("(r.departureDate IS NULL OR r.departureDate >= :fromDate)", { fromDate });
        if (filters.toDate) qb.andWhere("r.arrivalDate <= :toDate", { toDate: filters.toDate });
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
                qb.andWhere("LOWER(COALESCE(r.paidPart,'')) = 'part'");
                break;
            case "unpaid":
                qb.andWhere("LOWER(COALESCE(r.paidPart,'')) = 'none'");
                break;
            case "unknown":
                qb.andWhere("r.paidPart IS NULL");
                break;
            case "all":
            default:
                // no payment filter
                break;
        }

        const sortCol = filters.sortBy === "departure" ? "r.departureDate" : "r.arrivalDate";
        qb.orderBy(sortCol, "ASC").skip((page - 1) * perPage).take(perPage);

        const [reservations, total] = await qb.getManyAndCount();

        const listingIds = Array.from(
            new Set(reservations.map((r) => Number(r.listingMapId)).filter((id) => Number.isFinite(id) && id > 0))
        );
        const listings = listingIds.length
            ? await this.listingRepo.find({ where: { id: In(listingIds) }, withDeleted: true })
            : [];
        const listingMap = new Map(listings.map((l) => [Number(l.id), l]));

        const today = this.todayStr();
        const rows: OverdueRow[] = reservations.map((r) => {
            const listing = listingMap.get(Number(r.listingMapId)) || null;
            const total = this.toNum(r.totalPrice);
            const paid = this.toNum(r.paidAmount);
            const due = total != null ? Math.max(0, total - (paid ?? 0)) : null;
            const label = this.paymentLabel(r.paidPart, paid, total);
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
                listingName: r.listingName || listing?.internalListingName || null,
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
        emergenciesCleared: number;
    }> {
        if (!this.apiKey) {
            logger.warn("[OverduePayment] No Hostify API key configured; skipping payment sweep");
            return { checked: 0, updated: 0, emergenciesCleared: 0 };
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
            .andWhere("(COALESCE(r.source,'') NOT LIKE '%airbnb%' AND COALESCE(r.channelName,'') NOT LIKE '%airbnb%')")
            .andWhere("(r.departureDate IS NULL OR r.departureDate >= :fromStr)", { fromStr })
            .andWhere("(r.arrivalDate IS NULL OR r.arrivalDate <= :toStr)", { toStr })
            .orderBy("r.arrivalDate", "ASC")
            .take(limit);

        const reservations = await qb.getMany();
        let checked = 0;
        let updated = 0;
        let emergenciesCleared = 0;

        for (const r of reservations) {
            checked++;
            try {
                const data: any = await this.hostify.getReservationInfo(this.apiKey, r.id);
                const live = data?.reservation || {};
                const paidPart = live.paid_part != null ? String(live.paid_part) : null;
                const paidSum = this.toNum(live.paid_sum);
                if (paidPart == null && paidSum == null) continue;

                r.paidPart = paidPart ?? r.paidPart;
                if (paidSum != null) r.paidAmount = paidSum;
                r.paymentSyncedAt = new Date();
                await this.reservationRepo.save(r);
                updated++;

                // Clear a payment emergency once the balance is settled.
                if (this.isFullyPaid(r.paidPart, r.paidAmount, this.toNum(r.totalPrice))) {
                    const cleared = await this.clearEmergencyForReservation(r.id, "payment");
                    if (cleared) emergenciesCleared++;
                }
            } catch (err: any) {
                logger.warn(`[OverduePayment] sweep failed for reservation ${r.id}: ${err.message}`);
            }
        }

        logger.info(`[OverduePayment] Sweep — checked=${checked}, updated=${updated}, emergenciesCleared=${emergenciesCleared}`);
        return { checked, updated, emergenciesCleared };
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
            if (OverduePaymentService.isAirbnb(null, conversation.channel)) return { isEmergency: false, reason: null };

            const reservationId = Number(conversation.reservationId);
            const data: any = await this.hostify.getReservationInfo(this.apiKey, reservationId);
            const r = data?.reservation || {};
            if (!r || Object.keys(r).length === 0) return { isEmergency: false, reason: null };

            const status = String(r.status || "").toLowerCase();
            if (this.excludedStatus.map((s) => s.toLowerCase()).includes(status)) {
                return { isEmergency: false, reason: null };
            }
            // Double-check channel/source from the live record too.
            if (OverduePaymentService.isAirbnb(r.source, r.channel_name || r.integration_name)) {
                return { isEmergency: false, reason: null };
            }

            const paidPart = r.paid_part != null ? String(r.paid_part) : null;
            const paidSum = this.toNum(r.paid_sum);
            const subtotal = this.toNum(r.subtotal);
            const tax = this.toNum(r.tax_amount);
            let total: number | null = subtotal != null ? subtotal + (tax ?? 0) : this.toNum(r.total_price);
            if (total == null) {
                const stored = await this.reservationRepo.findOne({ where: { id: reservationId } });
                total = this.toNum(stored?.totalPrice);
            }

            // Persist what we learned regardless of the emergency outcome.
            try {
                await this.reservationRepo.update(
                    { id: reservationId },
                    {
                        paidPart: paidPart ?? undefined,
                        paidAmount: paidSum ?? undefined,
                        paymentSyncedAt: new Date(),
                    }
                );
            } catch {
                /* best-effort */
            }

            if (this.isFullyPaid(paidPart, paidSum, total)) return { isEmergency: false, reason: null };

            const arrival = this.dateStr(r.checkIn || r.arrivalDate);
            const departure = this.dateStr(r.checkOut || r.departureDate);
            const today = this.todayStr();
            // Trigger on the day the guest arrives — or if they should already have
            // arrived and the stay is still active — with an outstanding balance.
            const arrivingOrStaying = arrival != null && arrival <= today && (departure == null || departure >= today);
            if (!arrivingOrStaying) return { isEmergency: false, reason: null };

            const due = total != null ? Math.max(0, total - (paidSum ?? 0)) : null;
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

    /** Flag the conversation and email recipients (only on the 0 -> 1 transition). */
    async raiseEmergency(conversation: InboxConversationEntity, reason: string, type = "payment"): Promise<boolean> {
        const wasEmergency = Number(conversation.emergency) === 1 && conversation.emergencyType === type;
        conversation.emergency = 1;
        conversation.emergencyType = type;
        conversation.emergencyReason = reason ? reason.slice(0, 500) : null;
        if (!wasEmergency) conversation.emergencyAt = new Date();
        await this.conversationRepo.save(conversation);

        if (!wasEmergency) {
            await this.sendEmergencyEmail(conversation, reason).catch((e) =>
                logger.error(`[OverduePayment] emergency email failed for thread ${conversation.threadId}: ${e.message}`)
            );
        }
        return !wasEmergency;
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
