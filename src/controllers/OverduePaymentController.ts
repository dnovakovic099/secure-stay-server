import { NextFunction, Request, Response } from "express";
import { OverduePaymentService, OverdueFilters } from "../services/OverduePaymentService";

const toNum = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

export class OverduePaymentController {
    /** GET /overdue-payments — rich list of (default non-Airbnb) reservations with payment status. */
    async list(request: Request, response: Response, next: NextFunction) {
        try {
            const q = request.query;
            const filters: OverdueFilters = {
                includeAirbnb: q.includeAirbnb === "true",
                channel: (q.channel as string) || null,
                payment: (q.payment as OverdueFilters["payment"]) || "all",
                keyword: (q.keyword as string) || null,
                listingId: toNum(q.listingId),
                fromDate: (q.fromDate as string) || null,
                toDate: (q.toDate as string) || null,
                onlyArrived: q.onlyArrived === "true",
                page: toNum(q.page) || 1,
                perPage: toNum(q.perPage) || 25,
                sortBy: (q.sortBy as OverdueFilters["sortBy"]) || "arrival",
            };
            const data = await new OverduePaymentService().listOverdue(filters);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** POST /overdue-payments/sync — refresh payment status from Hostify for the relevant window. */
    async sync(request: Request, response: Response, next: NextFunction) {
        try {
            const b = request.body || {};
            const result = await new OverduePaymentService().syncPaymentStatus({
                lookbackDays: toNum(b.lookbackDays) ?? undefined,
                lookaheadDays: toNum(b.lookaheadDays) ?? undefined,
                limit: toNum(b.limit) ?? undefined,
            });
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    /** POST /overdue-payments/conversations/:threadId/resolve — clear a payment emergency. */
    async resolveEmergency(request: Request, response: Response, next: NextFunction) {
        try {
            const threadId = toNum(request.params.threadId);
            if (!threadId) return response.status(400).json({ status: false, message: "threadId required" });
            const cleared = await new OverduePaymentService().clearEmergency(threadId);
            return response.status(200).json({ status: true, data: { cleared } });
        } catch (error) {
            return next(error);
        }
    }
}
