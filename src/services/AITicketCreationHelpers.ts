import fs from "fs";
import path from "path";
import axios from "axios";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { Issue } from "../entity/Issue";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Listing } from "../entity/Listing";

export type IssueFileInfo = {
    fileName: string;
    filePath: string;
    mimeType: string;
    originalName: string;
};

const ISSUES_UPLOAD_DIR = path.join(process.cwd(), "public/issues");

/** Token overlap used to suppress near-duplicate Guest Issues. */
export function ticketTextSimilar(a: string, b: string, threshold = 0.5): boolean {
    const tok = (s: string) =>
        new Set(
            String(s || "")
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ")
                .split(/\s+/)
                .filter((w) => w.length > 3)
        );
    const A = tok(a);
    const B = tok(b);
    if (!A.size || !B.size) return false;
    let inter = 0;
    for (const w of A) if (B.has(w)) inter++;
    return inter / Math.min(A.size, B.size) >= threshold;
}

const SCHEDULE_REQUEST_RE =
    /\b(early\s*check[-\s]?in|late\s*check[-\s]?out|late\s*checkout|extend(?:ing|ed|s)?(?:\s+(?:my|our|the))?\s*(?:stay|checkout|check[-\s]?out|nights?)?|extension|extra\s+night|add(?:ing)?\s+(?:a\s+)?night|stay\s+(?:an?\s+)?(?:extra|another)\s+night)\b/i;

/** True when title/description/category looks like early check-in, late checkout, or extension. */
export function isScheduleRequestTicket(text: string, category?: string | null): boolean {
    const blob = `${category || ""} ${text || ""}`;
    return SCHEDULE_REQUEST_RE.test(blob);
}

function isValidTimeZone(timeZone?: string | null): boolean {
    if (!timeZone) return false;
    try {
        Intl.DateTimeFormat("en-US", { timeZone });
        return true;
    } catch {
        return false;
    }
}

function dateKeyInTz(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}

function parseDateKey(raw: any): string | null {
    if (raw == null) return null;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        // Calendar dates from Hostify are date-only — use UTC date parts.
        return raw.toISOString().slice(0, 10);
    }
    const s = String(raw).trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
}

function addDaysKey(yyyyMmDd: string, days: number): string {
    const [y, m, d] = yyyyMmDd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
}

/**
 * Arrival or departure is today or tomorrow in the property/ops timezone.
 * Used to force Critical urgency on early/late/extension tickets.
 */
export function isStayBoundaryTodayOrTomorrow(
    reservation?: Partial<ReservationInfoEntity> | null,
    listing?: Partial<Listing> | null
): boolean {
    const arrival = parseDateKey((reservation as any)?.arrivalDate);
    const departure = parseDateKey((reservation as any)?.departureDate);
    if (!arrival && !departure) return false;

    const tz =
        (isValidTimeZone((listing as any)?.timeZoneName) && String((listing as any).timeZoneName)) ||
        (isValidTimeZone((reservation as any)?.timeZoneName) && String((reservation as any).timeZoneName)) ||
        (isValidTimeZone((reservation as any)?.timezoneIdentifier) &&
            String((reservation as any).timezoneIdentifier)) ||
        "America/New_York";

    const today = dateKeyInTz(new Date(), tz);
    const tomorrow = addDaysKey(today, 1);
    return (
        (arrival != null && (arrival === today || arrival === tomorrow)) ||
        (departure != null && (departure === today || departure === tomorrow))
    );
}

/**
 * Force urgency 5 (Critical) for early check-in / late checkout / extension
 * when the stay's check-in or check-out is today or tomorrow.
 */
export function applyScheduleCriticalUrgency(
    baseUrgency: number | null | undefined,
    text: string,
    category: string | null | undefined,
    reservation?: Partial<ReservationInfoEntity> | null,
    listing?: Partial<Listing> | null
): number | null {
    if (isScheduleRequestTicket(text, category) && isStayBoundaryTodayOrTomorrow(reservation, listing)) {
        return 5;
    }
    return baseUrgency ?? null;
}

/** Open (non-completed) Guest Issues for a reservation in the last N days. */
export async function findOpenIssuesForReservation(
    reservationId: number | string,
    days = 14
): Promise<Issue[]> {
    if (!reservationId) return [];
    return appDatabase
        .getRepository(Issue)
        .createQueryBuilder("i")
        .where("i.reservation_id = :rid", { rid: String(reservationId) })
        .andWhere("i.created_at >= DATE_SUB(NOW(), INTERVAL :days DAY)", { days })
        .andWhere("(i.status IS NULL OR LOWER(i.status) NOT IN ('completed', 'cancelled', 'canceled'))")
        .andWhere("(i.gr_status IS NULL OR LOWER(i.gr_status) NOT IN ('completed', 'cancelled', 'canceled'))")
        .orderBy("i.created_at", "DESC")
        .take(50)
        .getMany();
}

/** True if an open issue on this reservation already covers the same fact. */
export async function findDuplicateOpenIssue(
    reservationId: number | string | null | undefined,
    title: string,
    description: string
): Promise<Issue | null> {
    if (!reservationId) return null;
    const open = await findOpenIssuesForReservation(reservationId);
    const candidate = `${title || ""} ${description || ""}`.trim();
    if (!candidate) return null;
    for (const existing of open) {
        const existingText = existing.issue_description || "";
        if (
            ticketTextSimilar(candidate, existingText) ||
            ticketTextSimilar(title || "", existingText) ||
            ticketTextSimilar(description || "", existingText)
        ) {
            return existing;
        }
    }
    return null;
}

function guessExtAndMime(url: string, contentType?: string | null): { ext: string; mime: string } {
    const ct = String(contentType || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
    if (ct.startsWith("image/")) {
        const sub = ct.slice("image/".length).replace("jpeg", "jpg");
        return { ext: sub || "jpg", mime: ct };
    }
    const pathPart = url.split("?")[0].toLowerCase();
    if (/\.png$/i.test(pathPart)) return { ext: "png", mime: "image/png" };
    if (/\.webp$/i.test(pathPart)) return { ext: "webp", mime: "image/webp" };
    if (/\.gif$/i.test(pathPart)) return { ext: "gif", mime: "image/gif" };
    if (/\.heic$/i.test(pathPart)) return { ext: "heic", mime: "image/heic" };
    return { ext: "jpg", mime: "image/jpeg" };
}

/** Download remote guest attachment URLs into public/issues for FileInfo rows. */
export async function downloadUrlsAsIssueFiles(urls: string[]): Promise<IssueFileInfo[]> {
    const unique = Array.from(
        new Set(
            (urls || [])
                .map((u) => String(u || "").trim())
                .filter((u) => /^https?:\/\//i.test(u))
        )
    ).slice(0, 8);
    if (!unique.length) return [];

    await fs.promises.mkdir(ISSUES_UPLOAD_DIR, { recursive: true }).catch(() => undefined);

    const out: IssueFileInfo[] = [];
    for (const url of unique) {
        try {
            const resp = await axios.get(url, {
                responseType: "arraybuffer",
                timeout: 20000,
                maxContentLength: 15 * 1024 * 1024,
                validateStatus: (s) => s >= 200 && s < 400,
            });
            const { ext, mime } = guessExtAndMime(url, resp.headers?.["content-type"]);
            const fileName = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const filePath = path.join(ISSUES_UPLOAD_DIR, fileName);
            await fs.promises.writeFile(filePath, Buffer.from(resp.data));
            out.push({
                fileName,
                filePath,
                mimeType: mime,
                originalName: fileName,
            });
        } catch (err: any) {
            logger.warn(`[AITicketCreation] failed to download attachment ${url.slice(0, 120)}: ${err?.message}`);
        }
    }
    return out;
}

/** Collect distinct guest photo URLs from recent inbox messages on a thread. */
export function collectGuestAttachmentUrls(
    messages: InboxMessageEntity[],
    opts: { aroundMessageId?: number | null; limit?: number } = {}
): string[] {
    const limit = opts.limit ?? 6;
    const incoming = (messages || []).filter(
        (m) => m.direction === "incoming" && (m.attachmentUrl || "").trim()
    );
    if (!incoming.length) return [];

    // Prefer messages near the triggering message, else the most recent guest media.
    let ordered = [...incoming].sort((a, b) => {
        const ta = a.sentAt ? new Date(a.sentAt).getTime() : 0;
        const tb = b.sentAt ? new Date(b.sentAt).getTime() : 0;
        return tb - ta;
    });

    if (opts.aroundMessageId != null) {
        const target = ordered.find(
            (m) =>
                Number(m.externalId) === Number(opts.aroundMessageId) ||
                Number(m.id) === Number(opts.aroundMessageId)
        );
        if (target?.sentAt) {
            const t = new Date(target.sentAt).getTime();
            ordered = ordered.sort(
                (a, b) =>
                    Math.abs(new Date(a.sentAt).getTime() - t) - Math.abs(new Date(b.sentAt).getTime() - t)
            );
        }
    }

    const urls: string[] = [];
    const seen = new Set<string>();
    for (const m of ordered) {
        const u = String(m.attachmentUrl || "").trim();
        if (!u || seen.has(u)) continue;
        seen.add(u);
        urls.push(u);
        if (urls.length >= limit) break;
    }
    return urls;
}

export function parseMediaUrlList(raw: string | null | undefined): string[] {
    if (!raw || !String(raw).trim()) return [];
    const s = String(raw).trim();
    try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
            return parsed.map(String).filter((u) => /^https?:\/\//i.test(u.trim()));
        }
    } catch {
        /* not JSON — treat as newline/comma list */
    }
    return s
        .split(/[\n,]+/)
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u));
}
