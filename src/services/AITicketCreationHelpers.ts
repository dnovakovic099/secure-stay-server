import fs from "fs";
import path from "path";
import axios from "axios";
import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { Issue } from "../entity/Issue";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Listing } from "../entity/Listing";

// Values of Issue.source we treat as "AI-created" for dedupe. Manual tickets
// (source NULL / 'manual') are intentionally excluded — per product ask, the
// AI must not skip creation just because a human already opened a ticket by
// hand. 'hostbuddy' is a legacy handoff pipeline that also auto-creates and
// still shows up in some tenants, so it stays in the set.
export const AI_ISSUE_SOURCES = ["ai_inbox", "ai_quo", "ai_beta", "hostbuddy"] as const;

const DUP_LOOKBACK_DAYS = Number(process.env.AI_DUP_LOOKBACK_DAYS || 30);
const DUP_STRONG_OVERLAP = Number(process.env.AI_DUP_STRONG_OVERLAP || 0.7);
const DUP_WEAK_OVERLAP = Number(process.env.AI_DUP_WEAK_OVERLAP || 0.35);
const SEMANTIC_GATE_ENABLED =
    String(process.env.AI_DUP_SEMANTIC_GATE_ENABLED || "true").toLowerCase() !== "false";
const SEMANTIC_GATE_MODEL = process.env.AI_DUP_SEMANTIC_GATE_MODEL || "gpt-4.1-mini";

// Whether the dedupe-hit path posts a paraphrased update onto the existing
// ticket. Behind a flag so we can roll out inbox → Quo and monitor Slack noise.
export const AI_TICKET_UPDATES_ENABLED =
    String(process.env.AI_TICKET_UPDATES_ENABLED || "true").toLowerCase() !== "false";
const PARAPHRASE_MODEL = process.env.AI_TICKET_UPDATE_MODEL || "gpt-4.1-mini";

// If the AI-paraphrased update text overlaps with any of the last N updates on
// the ticket beyond this threshold, we suppress it — otherwise chatty threads
// re-post the same "the guest is still waiting" note over and over.
const UPDATE_NOISE_OVERLAP = Number(process.env.AI_TICKET_UPDATE_NOISE_OVERLAP || 0.6);
const UPDATE_NOISE_LOOKBACK = Number(process.env.AI_TICKET_UPDATE_NOISE_LOOKBACK || 5);

export type IssueFileInfo = {
    fileName: string;
    filePath: string;
    mimeType: string;
    originalName: string;
};

const ISSUES_UPLOAD_DIR = path.join(process.cwd(), "public/issues");

const STOP_WORDS = new Set([
    "the",
    "and",
    "for",
    "that",
    "this",
    "with",
    "have",
    "from",
    "they",
    "them",
    "their",
    "there",
    "what",
    "when",
    "will",
    "would",
    "could",
    "about",
    "guest",
    "issue",
    "ticket",
    "please",
    "reported",
    "clarified",
    "requested",
    "complained",
    "confirmed",
    "asked",
]);

function tokenize(s: string): Set<string> {
    return new Set(
        String(s || "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    );
}

/** Token overlap ratio (Jaccard-style over the smaller set) used to suppress near-duplicate Guest Issues. */
export function ticketTextOverlap(a: string, b: string): number {
    const A = tokenize(a);
    const B = tokenize(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const w of A) if (B.has(w)) inter++;
    return inter / Math.min(A.size, B.size);
}

/** Backwards-compat wrapper: same shape as before, just delegates to ticketTextOverlap. */
export function ticketTextSimilar(a: string, b: string, threshold = 0.5): boolean {
    return ticketTextOverlap(a, b) >= threshold;
}

function categoriesMatch(a?: string | null, b?: string | null): boolean {
    const A = String(a || "").trim().toLowerCase();
    const B = String(b || "").trim().toLowerCase();
    if (!A || !B) return false;
    return A === B;
}

/**
 * LLM confirmation for suspected-but-not-certain duplicates. Cheap
 * `gpt-4.1-mini` call, guarded by AI_DUP_SEMANTIC_GATE_ENABLED. On any error
 * we fall back to "not a duplicate" so a broken model does not silently drop
 * legitimate new tickets.
 */
async function semanticIsDuplicate(
    candidateTitle: string,
    candidateDescription: string,
    existingIssue: Issue
): Promise<boolean> {
    if (!SEMANTIC_GATE_ENABLED) return false;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return false;

    const candidate = `${candidateTitle || ""}\n${candidateDescription || ""}`.trim();
    const existing = String(existingIssue.issue_description || "").trim();
    if (!candidate || !existing) return false;

    try {
        const client = new OpenAI({ apiKey });
        const completion = await client.chat.completions.create({
            model: SEMANTIC_GATE_MODEL,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: [
                        "You judge whether two short guest-issue reports describe the SAME operational fact",
                        "for the same reservation. Same fact means an ops rep would treat them as one ticket,",
                        "not two — even if worded very differently. Different symptoms of the same root problem",
                        "(e.g. 'no hot water' vs 'shower is cold') ARE the same fact. Two independent problems",
                        "on the same stay are NOT the same fact.",
                        "Respond STRICT JSON: {\"duplicate\": boolean, \"reason\": string}. No prose.",
                    ].join(" "),
                },
                {
                    role: "user",
                    content: [
                        `EXISTING TICKET (#${existingIssue.id}, category=${existingIssue.category || "-"}):`,
                        existing.slice(0, 800),
                        "",
                        `NEW CANDIDATE (category=${(candidateTitle && candidateDescription) ? "" : "-"}):`,
                        candidate.slice(0, 800),
                    ].join("\n"),
                },
            ],
        });
        const raw = completion.choices?.[0]?.message?.content || "{}";
        const parsed = JSON.parse(raw);
        return Boolean(parsed?.duplicate);
    } catch (err: any) {
        logger.warn(`[AIDedupe] semantic gate failed: ${err?.message}`);
        return false;
    }
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

/**
 * Open AI-created Guest Issues for a reservation in the last N days. Excludes
 * manual tickets so an ops rep opening a ticket by hand does not silence AI
 * detection of the same fact — the AI is only deduping against itself.
 */
export async function findOpenAIIssuesForReservation(
    reservationId: number | string,
    days = DUP_LOOKBACK_DAYS
): Promise<Issue[]> {
    if (!reservationId) return [];
    return appDatabase
        .getRepository(Issue)
        .createQueryBuilder("i")
        .where("i.reservation_id = :rid", { rid: String(reservationId) })
        .andWhere("i.source IN (:...sources)", { sources: AI_ISSUE_SOURCES as any })
        .andWhere("i.created_at >= DATE_SUB(NOW(), INTERVAL :days DAY)", { days })
        .andWhere("(i.status IS NULL OR LOWER(i.status) NOT IN ('completed', 'cancelled', 'canceled'))")
        .andWhere("(i.gr_status IS NULL OR LOWER(i.gr_status) NOT IN ('completed', 'cancelled', 'canceled'))")
        .orderBy("i.created_at", "DESC")
        .take(50)
        .getMany();
}

/**
 * Fallback lookup: recent open AI tickets whose aiSourceRef matches one of the
 * given prefixes. Used when the incoming thread has no reservation_id — we can
 * still notice we already ticketed the same detected item / action item.
 */
async function findOpenAIIssuesByAiSourceRefPrefix(
    prefixes: string[],
    days = DUP_LOOKBACK_DAYS
): Promise<Issue[]> {
    const cleaned = prefixes.map((p) => String(p || "").trim()).filter(Boolean);
    if (!cleaned.length) return [];
    const qb = appDatabase
        .getRepository(Issue)
        .createQueryBuilder("i")
        .where("i.source IN (:...sources)", { sources: AI_ISSUE_SOURCES as any })
        .andWhere("i.created_at >= DATE_SUB(NOW(), INTERVAL :days DAY)", { days })
        .andWhere("(i.status IS NULL OR LOWER(i.status) NOT IN ('completed', 'cancelled', 'canceled'))")
        .andWhere("(i.gr_status IS NULL OR LOWER(i.gr_status) NOT IN ('completed', 'cancelled', 'canceled'))");
    const parts = cleaned.map((_, idx) => `i.aiSourceRef LIKE :p${idx}`);
    const params: Record<string, string> = {};
    cleaned.forEach((p, idx) => (params[`p${idx}`] = `${p}%`));
    qb.andWhere(`(${parts.join(" OR ")})`, params);
    return qb.orderBy("i.created_at", "DESC").take(50).getMany();
}

/** @deprecated shim kept for any lingering imports — resolves to the AI-only version. */
export async function findOpenIssuesForReservation(
    reservationId: number | string,
    days = DUP_LOOKBACK_DAYS
): Promise<Issue[]> {
    return findOpenAIIssuesForReservation(reservationId, days);
}

export interface DedupeLookupParams {
    reservationId?: number | string | null;
    title: string;
    description: string;
    category?: string | null;
    /** Inbox thread id — used to look up prior ai_inbox tickets when reservationId is missing. */
    threadId?: number | null;
    /** Quo conversation id — used to look up prior ai_quo tickets when reservationId is missing. */
    quoConversationId?: string | null;
    /** Optional per-call override of the semantic-gate toggle. */
    semanticGate?: boolean;
}

async function collectDedupeCandidates(params: DedupeLookupParams): Promise<Issue[]> {
    const out = new Map<number, Issue>();
    if (params.reservationId) {
        for (const iss of await findOpenAIIssuesForReservation(params.reservationId)) {
            out.set(iss.id, iss);
        }
    }
    if (out.size) return [...out.values()];

    // Fallback: no reservation on the incoming thread (pre-booking chat, orphan
    // Quo line, etc.). Resolve prior AI ticket ids by walking the detector
    // audit tables and matching Issue.aiSourceRef.
    const prefixes: string[] = [];
    try {
        if (params.threadId != null) {
            const rows: Array<{ id: number }> = await appDatabase.query(
                "SELECT id FROM ai_detected_items WHERE threadId = ? AND status = 'created' AND createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY id DESC LIMIT 100",
                [Number(params.threadId), DUP_LOOKBACK_DAYS]
            );
            for (const r of rows || []) prefixes.push(`ai_detected_items:${r.id}`);
        }
    } catch (err: any) {
        logger.warn(`[AIDedupe] thread fallback lookup failed: ${err?.message}`);
    }
    try {
        if (params.quoConversationId) {
            const rows: Array<{ id: number }> = await appDatabase.query(
                "SELECT id FROM action_items WHERE quoConversationId = ? AND createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY id DESC LIMIT 100",
                [String(params.quoConversationId), DUP_LOOKBACK_DAYS]
            );
            for (const r of rows || []) prefixes.push(`action_items:${r.id}`);
        }
    } catch (err: any) {
        logger.warn(`[AIDedupe] quo fallback lookup failed: ${err?.message}`);
    }

    if (prefixes.length) {
        for (const iss of await findOpenAIIssuesByAiSourceRefPrefix(prefixes)) {
            out.set(iss.id, iss);
        }
    }
    return [...out.values()];
}

/**
 * True if an open AI issue already covers the same fact. Two-stage match:
 *   1. fast token overlap → strong hit ends the check
 *   2. borderline hits go through an LLM semantic gate
 * Returns the existing Issue so the caller can post an update onto it.
 */
export async function findDuplicateOpenAIIssue(params: DedupeLookupParams): Promise<Issue | null> {
    const candidateText = `${params.title || ""} ${params.description || ""}`.trim();
    if (!candidateText) return null;

    const open = await collectDedupeCandidates(params);
    if (!open.length) return null;

    let borderline: Issue | null = null;
    let borderlineOverlap = 0;

    for (const existing of open) {
        const existingText = existing.issue_description || "";
        const combinedOverlap = ticketTextOverlap(candidateText, existingText);
        const titleOverlap = ticketTextOverlap(params.title || "", existingText);
        const descOverlap = ticketTextOverlap(params.description || "", existingText);
        const best = Math.max(combinedOverlap, titleOverlap, descOverlap);
        const sameCategory = categoriesMatch(params.category, existing.category);

        // Strong hit — same category with high overlap, or very high overlap
        // regardless of category. Kill it here without an LLM call.
        if (best >= DUP_STRONG_OVERLAP && (sameCategory || best >= DUP_STRONG_OVERLAP + 0.1)) {
            return existing;
        }
        // Borderline — remember the best candidate and confirm with the LLM
        // gate once at the end (one extra call per burst, not per candidate).
        if (best >= DUP_WEAK_OVERLAP && best > borderlineOverlap) {
            borderline = existing;
            borderlineOverlap = best;
        }
    }

    if (!borderline) return null;

    const useGate = params.semanticGate ?? SEMANTIC_GATE_ENABLED;
    if (!useGate) return null;

    const confirmed = await semanticIsDuplicate(params.title || "", params.description || "", borderline);
    return confirmed ? borderline : null;
}

/**
 * Backwards-compat shim for callers that still pass positional args. Prefer
 * the object form (`findDuplicateOpenAIIssue`) for new code — it supports the
 * category + thread/conversation fallbacks needed for the new dedupe policy.
 */
export async function findDuplicateOpenIssue(
    reservationId: number | string | null | undefined,
    title: string,
    description: string
): Promise<Issue | null> {
    return findDuplicateOpenAIIssue({
        reservationId: reservationId ?? null,
        title,
        description,
    });
}

/**
 * Serialize AI ticket promotion for a given reservation across all detectors
 * (inbox + Quo) and across PM2 workers. Both pipelines can wake up on the same
 * reservation at nearly the same instant — without this, they'd each pass the
 * dedupe check simultaneously and both open a ticket. Callers pass the actual
 * create() work as `fn`. If the lock cannot be acquired, we still run `fn`
 * (the per-detector lock inside each service is the outer guard).
 */
export async function withReservationPromotionLock<T>(
    reservationId: number | string | null | undefined,
    fn: () => Promise<T>
): Promise<T> {
    if (!reservationId) return fn();
    const runner = appDatabase.createQueryRunner();
    const lockName = `ss_issue_promote_${reservationId}`;
    let held = false;
    try {
        await runner.connect();
        // 3s wait — enough for a sibling worker to finish the createIssue
        // path, short enough that a stuck lock does not stall a whole burst.
        const rows: any[] = await runner.query("SELECT GET_LOCK(?, 3) AS l", [lockName]);
        held = Boolean(Number(rows?.[0]?.l));
        return await fn();
    } catch (err) {
        throw err;
    } finally {
        if (held) {
            await runner.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
        }
        await runner.release().catch(() => undefined);
    }
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

// ---------------------------------------------------------------------------
// AI-paraphrased ticket updates (dedupe-hit path)
// ---------------------------------------------------------------------------

export interface ThreadUpdateContext {
    /** Where the message thread lives — surfaces in the update body. */
    channel: "hostify_inbox" | "quo_sms";
    /** The existing ticket the update is being posted onto. */
    existingIssue: Issue;
    /** Short label for the guest / contact — used for the summary line. */
    guestLabel?: string | null;
    /** Ordered transcript snippets (oldest→newest). Empty is OK — we fall back to the raw detected text. */
    transcript?: Array<{ who: "guest" | "team" | "auto"; text: string; at?: Date | string | null }>;
    /** Raw text of the new detected item / action item, used as fallback + focus signal. */
    detectedText: string;
    /** Optional category surfaced in the detected item. */
    category?: string | null;
}

/**
 * Ask the LLM to summarize what the guest just said that's new for this
 * ticket. Falls back to a lightly-formatted quote of the detected text so a
 * broken model does not silence the update entirely.
 */
async function paraphraseThreadUpdate(ctx: ThreadUpdateContext): Promise<string> {
    const channelLabel = ctx.channel === "quo_sms" ? "Quo SMS thread" : "Hostify inbox thread";
    const fallback = `New info from the ${channelLabel}: ${ctx.detectedText.trim()}`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return fallback;

    try {
        const client = new OpenAI({ apiKey });
        const transcriptLines = (ctx.transcript || [])
            .slice(-10)
            .map((m) => {
                const who = m.who === "guest" ? "GUEST" : m.who === "team" ? "TEAM" : "AUTO";
                const body = String(m.text || "").replace(/\s+/g, " ").trim();
                return body ? `- ${who}: ${body}` : "";
            })
            .filter(Boolean)
            .join("\n");

        const existingText = String(ctx.existingIssue.issue_description || "").slice(0, 400);

        const completion = await client.chat.completions.create({
            model: PARAPHRASE_MODEL,
            temperature: 0.2,
            messages: [
                {
                    role: "system",
                    content: [
                        "You are the AI ops assistant for a vacation rental team.",
                        "An existing Guest Issue ticket is already tracking a problem.",
                        `The guest just sent a new message on the ${channelLabel}.`,
                        "Write ONE short paragraph (max 2 sentences, max 60 words) summarizing what's NEW or CHANGED that the ops rep needs to know.",
                        "Quote the guest sparingly — pull key words in quotes, not full messages.",
                        "Do NOT restate what the ticket already covers, and do NOT include instructions to the rep.",
                        "Start with a channel tag: [Hostify inbox] or [Quo SMS], then the update.",
                        "If there is no genuinely new information, respond with the exact string: NO_NEW_INFO",
                    ].join(" "),
                },
                {
                    role: "user",
                    content: [
                        `EXISTING TICKET #${ctx.existingIssue.id} (${ctx.existingIssue.category || "—"}):`,
                        existingText,
                        "",
                        "DETECTED NEW ITEM:",
                        ctx.detectedText.slice(0, 600),
                        "",
                        transcriptLines
                            ? `RECENT TRANSCRIPT (oldest → newest):\n${transcriptLines}`
                            : "No transcript snippets available.",
                    ].join("\n"),
                },
            ],
        });
        const raw = String(completion.choices?.[0]?.message?.content || "").trim();
        if (!raw || /^NO_NEW_INFO$/i.test(raw)) return "";
        return raw;
    } catch (err: any) {
        logger.warn(`[AIUpdate] paraphrase failed for issue #${ctx.existingIssue.id}: ${err?.message}`);
        return fallback;
    }
}

/**
 * Decide whether posting `candidate` would be redundant given the last few
 * updates on the ticket. Uses the same token-overlap heuristic as dedupe.
 */
export async function isUpdateNoise(
    issueId: number,
    candidate: string,
    listRecent: (id: number, limit: number) => Promise<Array<{ updates: string | null }>>
): Promise<boolean> {
    const text = String(candidate || "").trim();
    if (!text) return true;
    try {
        const recent = await listRecent(issueId, UPDATE_NOISE_LOOKBACK);
        for (const u of recent) {
            const prev = String(u?.updates || "").trim();
            if (!prev) continue;
            if (ticketTextOverlap(text, prev) >= UPDATE_NOISE_OVERLAP) return true;
        }
    } catch (err: any) {
        logger.warn(`[AIUpdate] noise check failed for issue #${issueId}: ${err?.message}`);
    }
    return false;
}

/**
 * Backfill Issue.aiSourceRef when we discovered the ticket was a dupe of the
 * incoming detection. Subsequent scans then match by ref instead of by fuzzy
 * text. No-op if the ref column is already set.
 */
export async function backfillAISourceRef(issueId: number, aiSourceRef: string): Promise<void> {
    const ref = String(aiSourceRef || "").trim();
    if (!issueId || !ref) return;
    try {
        await appDatabase
            .getRepository(Issue)
            .createQueryBuilder()
            .update(Issue)
            .set({ aiSourceRef: ref })
            .where("id = :id", { id: Number(issueId) })
            .andWhere("(aiSourceRef IS NULL OR aiSourceRef = '')")
            .execute();
    } catch (err: any) {
        logger.warn(`[AIUpdate] backfill aiSourceRef on issue #${issueId} failed: ${err?.message}`);
    }
}

export interface PostAIUpdateResult {
    posted: boolean;
    reason?: "disabled" | "empty_paraphrase" | "noise" | "no_service" | "error";
    updateId?: number;
}

/**
 * End-to-end: paraphrase → noise-check → post via IssuesService. The service
 * dep is injected so this helper stays free of hard imports on IssuesService
 * (which sits above it in the module graph).
 */
export async function postDedupeUpdate(
    ctx: ThreadUpdateContext,
    deps: {
        postAIThreadUpdate: (issueId: number, text: string, opts?: any) => Promise<{ id: number } | null>;
        listRecentIssueUpdates: (issueId: number, limit: number) => Promise<Array<{ updates: string | null }>>;
    }
): Promise<PostAIUpdateResult> {
    if (!AI_TICKET_UPDATES_ENABLED) return { posted: false, reason: "disabled" };
    if (!deps?.postAIThreadUpdate || !deps?.listRecentIssueUpdates) {
        return { posted: false, reason: "no_service" };
    }

    let paraphrased: string;
    try {
        paraphrased = await paraphraseThreadUpdate(ctx);
    } catch (err: any) {
        logger.warn(`[AIUpdate] paraphrase threw for issue #${ctx.existingIssue.id}: ${err?.message}`);
        return { posted: false, reason: "error" };
    }
    if (!paraphrased.trim()) return { posted: false, reason: "empty_paraphrase" };

    const noise = await isUpdateNoise(ctx.existingIssue.id, paraphrased, deps.listRecentIssueUpdates);
    if (noise) {
        logger.info(
            `[AIUpdate] suppress paraphrased update on issue #${ctx.existingIssue.id} — near-duplicate of a recent update`
        );
        return { posted: false, reason: "noise" };
    }

    try {
        const saved = await deps.postAIThreadUpdate(ctx.existingIssue.id, paraphrased);
        if (!saved) return { posted: false, reason: "error" };
        return { posted: true, updateId: saved.id };
    } catch (err: any) {
        logger.error(`[AIUpdate] post failed for issue #${ctx.existingIssue.id}: ${err?.message}`);
        return { posted: false, reason: "error" };
    }
}
