import OpenAI from "openai";
import { appDatabase } from "../../utils/database.util";
import { RetrievalService } from "../RetrievalService";
import { Viewer, requireCapability } from "./viewer";
import { factFieldLabel } from "../../config/propertyFactFields";

/**
 * The assistant's tool layer.
 *
 * Every tool is a hand-written, parameterised query. The model never authors
 * SQL — it picks a tool and arguments. That gives us three things at once:
 *
 *  - Security: the capability check and any row filtering happen HERE, in
 *    TypeScript, against the resolved Viewer. Prompt injection cannot reach it.
 *  - Cost: tools return small focused rows instead of a context dump, and the
 *    tool schemas are byte-stable so they sit in the prompt cache.
 *  - Accuracy: the join/dedup rules that raw SQL keeps getting wrong (issues
 *    .listing_id is a VARCHAR, channel-split listings share a group) live in
 *    tested code rather than in prompt instructions the model can drift from.
 *
 * Results are self-describing: each payload carries a `note` when there is a
 * caveat the model must pass on rather than paper over.
 */

const DAY_MS = 86_400_000;

export interface ToolContext {
    viewer: Viewer;
    /** Set by a tool when its result contained credentials, for the audit row. */
    returnedCredentials?: boolean;
}

export interface ToolResult {
    data: any;
    rowCount?: number;
}

/**
 * A usable row id, or null. The model sometimes passes a listingId it built from
 * text, and mysql2 renders NaN as a bare SQL token, which comes back as "Unknown
 * column 'NaN'" instead of an empty result.
 */
const asId = (v: any): number | null => {
    const n = Number(v);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * Is `who` the caller themselves? Absent means the question named nobody, which
 * is the "how did I do today" case. Matching is loose on purpose: staff write
 * "Priya", "priya k", or an email, and the cost of a false negative is only a
 * redirect to team_activity, while a false positive misattributes someone's work.
 */
const isSelf = (who: any, viewer: { userName: string | null; email: string | null }): boolean => {
    const raw = String(who ?? "").trim().toLowerCase();
    if (!raw) return true;
    if (/^(me|myself|i|my|mine|self)$/.test(raw)) return true;

    const name = (viewer.userName || "").toLowerCase().trim();
    const email = (viewer.email || "").toLowerCase().trim();
    if (raw === name || raw === email) return true;
    if (email && raw === email.split("@")[0]) return true;
    if (!name) return false;
    // Share a distinctive name part, e.g. "Priya" against "Priya Kulkarni".
    const parts = (s: string) => new Set(s.split(/[^a-z0-9]+/).filter((p) => p.length > 2));
    const mine = parts(name);
    for (const p of parts(raw)) if (mine.has(p)) return true;
    return false;
};

const clampDays = (v: any, def: number, max: number) => {
    const n = Math.round(Number(v) || def);
    return Math.min(max, Math.max(1, n));
};

/**
 * Credential fields are free text, and staff have typed placeholders into them
 * for years: "(NO WIFI)", "N/A", "TBD", "-". Returning those verbatim makes the
 * assistant tell someone the wifi password is "(NO PASSWORD)", so treat them as
 * absent and let the answer say it is not on file.
 */
const credential = (v: any): string | null => {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const bare = s.replace(/[()[\]]/g, "").replace(/[\s_-]+/g, " ").trim().toLowerCase();
    const placeholder =
        /^(n\/?a|na|none|no|null|nil|tbd|tba|unknown|pending|missing|not applicable|no wifi|no password|no code|no wifi password|does not apply|\.|-|\?+)$/;
    return placeholder.test(bare) ? null : s;
};

/**
 * Turn a question into keywords worth a LIKE scan. Drops filler so "how do door
 * codes work at Scottsdale" searches for door/code rather than matching every
 * message containing "how". Trailing plurals are trimmed so "codes" finds "code".
 */
const STOPWORDS = new Set(
    ("a an the is are was were be been do does did how what when where which who whom why " +
        "can could should would will shall may might must i we you they it he she this that these " +
        "those to for from with without at in on of by about into over under again our your their " +
        "my me us them there here and or but if then than so as any all some no not out up down " +
        "get got give tell show find need want know work works working use used using please " +
        "property listing house home guest").split(" ")
);
const keywords = (raw: string): string[] => {
    const words = String(raw || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
        .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
    return [...new Set(words)].slice(0, 5);
};
const matchedTerms = (text: string, terms: string[]): string[] => {
    const t = String(text || "").toLowerCase();
    return terms.filter((k) => t.includes(k));
};

const WINDOW = 340;

/**
 * A slice of the text where the keywords actually cluster.
 *
 * Centring on the FIRST keyword is wrong for the messages that matter most: a
 * guest arrival template mentions parking, trash, wifi and the door code in one
 * long block, so the first hit on "code" can be hundreds of characters away from
 * the part that answers the question. Pick the window containing the most
 * distinct keywords instead.
 */
const snippet = (text: string, terms: string[]): string => {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (s.length <= WINDOW) return s;
    const lower = s.toLowerCase();

    const hits: { at: number; term: string }[] = [];
    for (const term of terms) {
        let i = lower.indexOf(term);
        while (i !== -1 && hits.length < 400) {
            hits.push({ at: i, term });
            i = lower.indexOf(term, i + term.length);
        }
    }
    if (!hits.length) return `${s.slice(0, WINDOW)}…`;

    let bestStart = Math.max(0, hits[0].at - 110);
    let bestScore = -1;
    for (const h of hits) {
        const start = Math.max(0, h.at - 110);
        const inWindow = hits.filter((q) => q.at >= start && q.at < start + WINDOW);
        const score = new Set(inWindow.map((q) => q.term)).size * 10 + inWindow.length;
        if (score > bestScore) {
            bestScore = score;
            bestStart = start;
        }
    }
    const end = Math.min(s.length, bestStart + WINDOW);
    return `${bestStart > 0 ? "…" : ""}${s.slice(bestStart, end)}${end < s.length ? "…" : ""}`;
};

/** listing_info.checkInTimeStart etc. are stored as an hour integer (0-23). */
const hour = (h: any): string | null => {
    const n = Number(h);
    if (!Number.isFinite(n) || n < 0 || n > 23) return null;
    return `${((n + 11) % 12) + 1}:00 ${n < 12 ? "AM" : "PM"}`;
};

// ── property resolution ──────────────────────────────────────────────────────

interface ResolvedListing {
    listingId: number;
    groupId: number | null;
    name: string;
    city: string | null;
    state: string | null;
}

/**
 * Resolve a free-text property reference to listings. Deliberately broad: staff
 * say "Scottsdale" (a city with several properties), "the Waller house", or an
 * exact internal name. Channel-split duplicates collapse to one row per group.
 */
async function resolveListings(query: string, limit = 12): Promise<ResolvedListing[]> {
    const q = (query || "").trim();
    if (!q) return [];
    const like = `%${q}%`;
    const rows: any[] = await appDatabase.query(
        `SELECT li.id, li.name, li.internalListingName, li.externalListingName,
                li.city, li.state, lgm.groupId
         FROM listing_info li
         LEFT JOIN listing_group_map lgm ON lgm.listingId = li.id
         WHERE li.deletedAt IS NULL
           AND (li.internalListingName LIKE ? OR li.externalListingName LIKE ?
                OR li.name LIKE ? OR li.city LIKE ? OR li.address LIKE ?)
         ORDER BY
           CASE WHEN li.internalListingName = ? THEN 0
                WHEN li.city = ? THEN 1
                ELSE 2 END,
           li.internalListingName
         LIMIT ?`,
        [like, like, like, like, like, q, q, limit * 3]
    );

    const seenGroup = new Set<number>();
    const out: ResolvedListing[] = [];
    for (const r of rows) {
        const groupId = r.groupId != null ? Number(r.groupId) : null;
        // Airbnb/Vrbo copies of one property share a groupId — keep the first.
        if (groupId != null) {
            if (seenGroup.has(groupId)) continue;
            seenGroup.add(groupId);
        }
        out.push({
            listingId: Number(r.id),
            groupId,
            name: r.internalListingName || r.name || r.externalListingName || `Listing ${r.id}`,
            city: r.city || null,
            state: r.state || null,
        });
        if (out.length >= limit) break;
    }
    return out;
}

/** Resolve either an explicit listingId or a text query down to one listing. */
async function resolveOne(
    args: { listingId?: number; property?: string }
): Promise<{ listing: ResolvedListing | null; ambiguous: ResolvedListing[] }> {
    const explicitId = asId(args.listingId);
    if (explicitId) {
        const rows: any[] = await appDatabase.query(
            `SELECT li.id, li.name, li.internalListingName, li.externalListingName,
                    li.city, li.state, lgm.groupId
             FROM listing_info li
             LEFT JOIN listing_group_map lgm ON lgm.listingId = li.id
             WHERE li.id = ? LIMIT 1`,
            [explicitId]
        );
        const r = rows[0];
        if (!r) return { listing: null, ambiguous: [] };
        return {
            listing: {
                listingId: Number(r.id),
                groupId: r.groupId != null ? Number(r.groupId) : null,
                name: r.internalListingName || r.name || `Listing ${r.id}`,
                city: r.city || null,
                state: r.state || null,
            },
            ambiguous: [],
        };
    }
    const matches = await resolveListings(args.property || "", 12);
    if (matches.length === 1) return { listing: matches[0], ambiguous: [] };
    return { listing: null, ambiguous: matches };
}

// ── tool schemas (byte-stable: keep edits deliberate, they invalidate cache) ──

export const TOOL_SCHEMAS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "find_property",
            description:
                "Resolve a property reference (nickname, internal name, city, or address) to listing IDs. " +
                "Call this FIRST whenever the user names a place, unless you already have the listingId from " +
                "earlier in the conversation. A city like 'Scottsdale' can match several properties.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "What the user called the property." },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "property_knowledge",
            description:
                "Operational knowledge for one property: check-in/out times and instructions, access and " +
                "arrival steps, parking, house rules, amenities, quirks. Draws on verified property facts, " +
                "the team knowledge base, and the onboarding record, in that order of authority. " +
                "Use for 'what are X's check-in instructions', 'is X pet friendly', 'where do guests park'.",
            parameters: {
                type: "object",
                properties: {
                    listingId: { type: "number", description: "Preferred, from find_property." },
                    property: { type: "string", description: "Property name, if you have no listingId." },
                    topic: {
                        type: "string",
                        description:
                            "Optional focus, e.g. 'check-in', 'parking', 'pets', 'pool'. Narrows the result.",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "verified_facts_drafting_context",
            description:
                "Read-only research bundle for the specialized Verified Facts drafting workflow. Use when an " +
                "employee wants help deciding or drafting what to paste into a Verified Facts topic. Returns current " +
                "Verified Facts (including Hostify values and internal guidance), listing/KB/onboarding knowledge, " +
                "approved learned information, and linked Upsell policy. It never saves or verifies anything. Resolve " +
                "the property first, then use search_history for the requested topic when this bundle is incomplete.",
            parameters: {
                type: "object",
                properties: {
                    listingId: { type: "number", description: "Preferred, from find_property." },
                    property: { type: "string", description: "Property name if there is no listingId." },
                    topic: {
                        type: "string",
                        description: "The Verified Facts topic being drafted, e.g. pool heating or early check-in.",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "property_credentials",
            description:
                "Wifi network and password, lockbox code, and standard door code for one property. " +
                "Staff need these for guest support. Every call is audited. Do not volunteer these unless " +
                "the user actually asked for access details.",
            parameters: {
                type: "object",
                properties: {
                    listingId: { type: "number" },
                    property: { type: "string" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "search_knowledge",
            description:
                "Semantic search across the team knowledge base, uploaded house manuals, and approved " +
                "learned answers. Use when the question is phrased loosely, spans properties, or " +
                "property_knowledge came back thin. Scope to one property with listingId when you can.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "The question, in the user's own words." },
                    listingId: { type: "number", description: "Optional: restrict to one property." },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "search_history",
            description:
                "Keyword search through what the team has ACTUALLY WRITTEN: guest message threads " +
                "(including automated templates sent to guests), ticket descriptions, next steps and " +
                "resolutions, and internal ticket discussion. This is the fallback when the structured " +
                "records are empty — staff have often explained a procedure to a guest, or worked it out on " +
                "a ticket, without anyone entering it as a property field. Use it before telling someone " +
                "you could not find something. Scope with listingId or property when the question is " +
                "about one house.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description:
                            "Keywords to look for, e.g. 'door code' or 'gate remote'. Plain words work " +
                            "better than a full sentence.",
                    },
                    listingId: { type: "number", description: "Restrict to one property." },
                    property: { type: "string", description: "Property name or nickname, if you have no listingId." },
                    months: { type: "number", description: "How far back to look. Default 24." },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "my_activity",
            description:
                "The CALLER'S OWN productivity for a trailing window: guest replies sent, Quo messages and " +
                "calls, daily effort/quality grades, and hours clocked. Use for 'how did I do today', " +
                "'how many messages have I sent'. This only ever returns the caller's own numbers, so if " +
                "the question is about a named colleague, call team_activity instead — reporting these " +
                "figures would attribute the caller's work to someone else.",
            parameters: {
                type: "object",
                properties: {
                    days: { type: "number", description: "Trailing days, 1-90 (default 7)." },
                    about: {
                        type: "string",
                        description:
                            "Who the question is about. Always set this when the question names a person, " +
                            "even if that person is the caller. Leave it out only for 'how did I do' style " +
                            "questions that name nobody.",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "team_activity",
            description:
                "Per-person productivity for the whole team over a trailing window. ADMIN ONLY — if the " +
                "caller is not an admin this returns a refusal, which you must relay plainly without " +
                "guessing at numbers. Use for 'who handled the most tickets', 'how many replies did <name> send'.",
            parameters: {
                type: "object",
                properties: {
                    days: { type: "number", description: "Trailing days, 1-90 (default 7)." },
                    employee: { type: "string", description: "Optional: narrow to one person by name." },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "open_issues",
            description:
                "Guest issues and maintenance tickets, newest first. Filter by property, category, status, " +
                "or assignee. Use for 'what's open at X', 'any pool tickets this week'.",
            parameters: {
                type: "object",
                properties: {
                    listingId: { type: "number" },
                    property: { type: "string" },
                    category: { type: "string", description: "e.g. MAINTENANCE, HVAC, CLEANLINESS, REFUNDS." },
                    onlyOpen: { type: "boolean", description: "Default true. False includes completed." },
                    days: { type: "number", description: "Trailing days, 1-180 (default 30)." },
                    assignee: { type: "string" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "reservation_lookup",
            description:
                "Look up reservations by guest name, confirmation code, or property, optionally within a " +
                "date window. Returns stay dates, channel, guest contact, status and total. Use for " +
                "'who is checking into X tomorrow', 'find the Henderson booking'. Every filter is " +
                "optional: 'who arrives tomorrow' with no property named is a valid portfolio-wide " +
                "question — call this with arrivingWithinDays and answer it rather than asking which " +
                "property they meant.",
            parameters: {
                type: "object",
                properties: {
                    guest: { type: "string" },
                    reservationId: { type: "string", description: "Confirmation / channel code." },
                    listingId: { type: "number" },
                    property: { type: "string" },
                    arrivingWithinDays: {
                        type: "number",
                        description: "Only stays arriving in the next N days, 1-90.",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "my_tasks",
            description:
                "The caller's own assigned tasks. Use for 'what's on my plate', 'what am I behind on'.",
            parameters: {
                type: "object",
                properties: {
                    includeCompleted: { type: "boolean", description: "Default false." },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "vendor_lookup",
            description:
                "The vendor and contractor phone book: who to call for a trade in a city. Use for " +
                "'who do we use for HVAC in Tampa', 'plumber near the Scottsdale house'.",
            parameters: {
                type: "object",
                properties: {
                    city: { type: "string" },
                    category: { type: "string", description: "Trade, e.g. HVAC, plumbing, pool, pest." },
                    name: { type: "string", description: "Search by vendor name." },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "upsell_policy",
            description:
                "Early check-in, late checkout, pool heat and other paid-extra policy and pricing for a " +
                "property, including internal notes. Use before quoting a guest a fee.",
            parameters: {
                type: "object",
                properties: {
                    listingId: { type: "number" },
                    property: { type: "string" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "expense_summary",
            description:
                "Expenses by month and category, optionally for one property. Use for 'what did we spend " +
                "at X', 'cleaning costs last quarter'. Does not include payroll.",
            parameters: {
                type: "object",
                properties: {
                    listingId: { type: "number" },
                    property: { type: "string" },
                    months: { type: "number", description: "Trailing months, 1-12 (default 3)." },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "employee_directory",
            description:
                "Who works here: name, department, job title, active status. Contains NO compensation. " +
                "Use for 'who is on guest relations', 'what's Angelica's role'.",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    department: { type: "string" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "payroll_lookup",
            description:
                "Hourly rates and hours worked. SUPER ADMIN ONLY — returns a refusal otherwise, which you " +
                "must relay plainly. Never infer or estimate pay from any other tool's output.",
            parameters: {
                type: "object",
                properties: {
                    employee: { type: "string" },
                    days: { type: "number", description: "Trailing days for hours, 1-90 (default 14)." },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "portfolio_overview",
            description:
                "Cheap orientation: how many active properties, which cities and states, and current open " +
                "ticket counts. Use to ground vague questions before drilling in.",
            parameters: { type: "object", properties: {} },
        },
    },
];

// ── handlers ─────────────────────────────────────────────────────────────────

type Handler = (args: any, ctx: ToolContext) => Promise<ToolResult>;

const ambiguityResult = (matches: ResolvedListing[]): ToolResult => ({
    data: {
        resolved: false,
        note:
            matches.length === 0
                ? "No property matched. Ask the user to confirm the name, or call portfolio_overview to see what exists."
                : "Several properties matched. Ask the user which one, or answer for all of them if that is what they meant.",
        matches,
    },
    rowCount: matches.length,
});

const handlers: Record<string, Handler> = {
    async find_property(args, ctx) {
        requireCapability(ctx.viewer, "property.knowledge", "Property lookup is not available to you.");
        const matches = await resolveListings(String(args.query || ""), 15);
        return { data: { matches, count: matches.length }, rowCount: matches.length };
    },

    async property_knowledge(args, ctx) {
        requireCapability(ctx.viewer, "property.knowledge", "Property knowledge is not available to you.");
        const { listing, ambiguous } = await resolveOne(args);
        if (!listing) return ambiguityResult(ambiguous);

        const topic = (args.topic || "").toString().trim();
        const groupId = listing.groupId ?? listing.listingId;

        const [basics, facts, kb, onboarding] = await Promise.all([
            appDatabase.query(
                `SELECT checkInTimeStart, checkInTimeEnd, checkOutTime, personCapacity,
                        bedroomsNumber, bathroomsNumber, minNights, maxNights, cleaningFee,
                        address, city, state, timeZoneName, propertyLicenseNumber
                 FROM listing_info WHERE id = ? LIMIT 1`,
                [listing.listingId]
            ),
            appDatabase.query(
                `SELECT fieldKey, value, status FROM property_facts
                 WHERE listingId IN (?, ?) AND value IS NOT NULL AND value <> ''
                 ORDER BY FIELD(status,'verified','unverified'), fieldKey`,
                [listing.listingId, groupId]
            ),
            topic
                ? appDatabase.query(
                      `SELECT category, title, content, visibility FROM listing_knowledge_entries
                       WHERE listingId IN (?, ?) AND COALESCE(isArchived,0) = 0
                         AND (category LIKE ? OR title LIKE ? OR content LIKE ?)
                       ORDER BY FIELD(visibility,'internal','external') LIMIT 12`,
                      [listing.listingId, groupId, `%${topic}%`, `%${topic}%`, `%${topic}%`]
                  )
                : appDatabase.query(
                      `SELECT category, title, content, visibility FROM listing_knowledge_entries
                       WHERE listingId IN (?, ?) AND COALESCE(isArchived,0) = 0
                       ORDER BY FIELD(visibility,'internal','external'), category LIMIT 20`,
                      [listing.listingId, groupId]
                  ),
            appDatabase.query(
                `SELECT pi.checkInInstructions, pi.checkOutInstructions, pi.doorLockInstructions,
                        pi.parkingInstructions, pi.houseRulesText, pi.otherHouseRules, pi.houseManualText
                 FROM property_info pi
                 JOIN listing_info li ON li.internalListingName = pi.internalListingName
                 WHERE li.id = ? LIMIT 1`,
                [listing.listingId]
            ).catch(() => []),
        ]);

        const b = basics[0] || {};
        const trim = (v: any, n = 1500) =>
            v == null || String(v).trim() === "" ? undefined : String(v).trim().slice(0, n);
        const ob = onboarding[0] || {};

        return {
            data: {
                resolved: true,
                property: listing,
                times: {
                    checkIn: hour(b.checkInTimeStart),
                    checkInUntil: hour(b.checkInTimeEnd),
                    checkOut: hour(b.checkOutTime),
                    timeZone: b.timeZoneName || null,
                },
                layout: {
                    sleeps: b.personCapacity ?? null,
                    bedrooms: b.bedroomsNumber ?? null,
                    bathrooms: b.bathroomsNumber ?? null,
                    minNights: b.minNights ?? null,
                    cleaningFee: b.cleaningFee ?? null,
                },
                address: b.address || null,
                licenseNumber: b.propertyLicenseNumber || null,
                verifiedFacts: (facts as any[]).map((f) => ({
                    field: f.fieldKey,
                    value: String(f.value).slice(0, 600),
                    verified: f.status === "verified",
                })),
                knowledgeBase: (kb as any[]).map((k) => ({
                    category: k.category,
                    title: k.title,
                    staffOnly: k.visibility === "internal",
                    content: String(k.content || "").slice(0, 1400),
                })),
                onboardingRecord: {
                    checkIn: trim(ob.checkInInstructions),
                    checkOut: trim(ob.checkOutInstructions),
                    doorLock: trim(ob.doorLockInstructions),
                    parking: trim(ob.parkingInstructions),
                    houseRules: trim(ob.houseRulesText) || trim(ob.otherHouseRules),
                    houseManual: trim(ob.houseManualText, 2500),
                },
                note:
                    "Authority order: verifiedFacts (human-confirmed) beats knowledgeBase beats " +
                    "onboardingRecord. knowledgeBase entries marked staffOnly must not be read out to a " +
                    "guest verbatim. If nothing here answers the question, say so and suggest search_knowledge.",
            },
            rowCount: (facts as any[]).length + (kb as any[]).length,
        };
    },

    async verified_facts_drafting_context(args, ctx) {
        requireCapability(ctx.viewer, "property.knowledge", "Property knowledge is not available to you.");
        const { listing, ambiguous } = await resolveOne(args);
        if (!listing) return ambiguityResult(ambiguous);

        const topic = String(args.topic || "").trim();
        const groupIds = [...new Set([listing.listingId, listing.groupId].filter((id): id is number => id != null))];
        const placeholders = groupIds.map(() => "?").join(",");
        const [knowledge, facts, learned, upsells] = await Promise.all([
            handlers.property_knowledge({ listingId: listing.listingId, topic }, ctx),
            appDatabase.query(
                `SELECT fieldKey, value, hostifyValue, internalInstructions, status, source, verifiedAt, updatedAt
                 FROM property_facts
                 WHERE listingId IN (${placeholders})
                 ORDER BY FIELD(status,'verified','unverified'), fieldKey`,
                groupIds
            ).catch(() => []),
            appDatabase.query(
                `SELECT scope, listingId, topic, factType, memoryType, visibility, question, answer,
                        decisionRationale, frequency, source, lastSeenAt, validUntil
                 FROM ai_learned_facts
                 WHERE status = 'approved' AND supersededByFactId IS NULL
                   AND (scope = 'portfolio' OR listingId IN (${placeholders}))
                   ${topic ? "AND (topic LIKE ? OR question LIKE ? OR answer LIKE ?)" : ""}
                 ORDER BY COALESCE(lastSeenAt, updatedAt) DESC
                 LIMIT 30`,
                topic ? [...groupIds, `%${topic}%`, `%${topic}%`, `%${topic}%`] : groupIds
            ).catch(() => []),
            handlers.upsell_policy({ listingId: listing.listingId }, ctx).catch(() => ({ data: { policies: [] } })),
        ]);

        const factRows = (facts as any[]).map((fact) => ({
            fieldKey: fact.fieldKey,
            label: factFieldLabel(String(fact.fieldKey)),
            guestShareableInformation: fact.value || null,
            hostifyValue: fact.hostifyValue || null,
            internalOnlyGuidance: fact.internalInstructions || null,
            status: fact.status,
            source: fact.source,
            verifiedAt: fact.verifiedAt,
            updatedAt: fact.updatedAt,
        }));

        return {
            data: {
                property: listing,
                requestedTopic: topic || null,
                currentVerifiedFacts: factRows,
                storedPropertyKnowledge: knowledge.data,
                approvedLearnedInformation: learned,
                linkedUpsellPolicy: upsells.data,
                draftingRules: {
                    noWrite:
                        "This tool only researches. It does not save, verify, publish, or push the drafted text.",
                    authority:
                        "Verified facts outrank approved supporting knowledge. Treat message history as evidence to label and verify, not automatic truth.",
                    output:
                        "Draft separate Hostify value, Guest-shareable information, and Internal-only AI guidance sections. Use numbered RULE / END RULE blocks for independent conditions and scope each OTHERWISE inside its rule.",
                },
            },
            rowCount: factRows.length + (learned as any[]).length,
        };
    },

    async property_credentials(args, ctx) {
        requireCapability(
            ctx.viewer,
            "property.credentials",
            "Access credentials are not available to you."
        );
        const { listing, ambiguous } = await resolveOne(args);
        if (!listing) return ambiguityResult(ambiguous);
        ctx.returnedCredentials = true;

        const groupId = listing.groupId ?? listing.listingId;
        const [wifi, locks, facts] = await Promise.all([
            appDatabase.query(
                `SELECT wifiUsername, wifiPassword FROM listing_info WHERE id = ? LIMIT 1`,
                [listing.listingId]
            ),
            appDatabase.query(
                `SELECT pls.default_access_code, pls.auto_generate_codes
                 FROM property_lock_settings pls
                 JOIN property_info pi ON pi.id = pls.property_id
                 JOIN listing_info li ON li.internalListingName = pi.internalListingName
                 WHERE li.id = ? LIMIT 1`,
                [listing.listingId]
            ).catch(() => []),
            appDatabase.query(
                `SELECT fieldKey, value FROM property_facts
                 WHERE listingId IN (?, ?)
                   AND fieldKey IN ('access_type','lockout_procedure','address_release')
                   AND value IS NOT NULL AND value <> ''`,
                [listing.listingId, groupId]
            ),
        ]);

        const w = wifi[0] || {};
        const l = (locks as any[])[0] || {};
        const wifiNetwork = credential(w.wifiUsername);
        const wifiPassword = credential(w.wifiPassword);
        return {
            data: {
                resolved: true,
                property: listing,
                wifi: {
                    network: wifiNetwork,
                    password: wifiPassword,
                    ...(wifiNetwork || wifiPassword
                        ? {}
                        : { note: "No wifi credentials on file for this property." }),
                },
                standardDoorCode: credential(l.default_access_code),
                autoGeneratesGuestCodes: l.auto_generate_codes == null ? null : Boolean(l.auto_generate_codes),
                accessNotes: (facts as any[]).map((f) => ({ field: f.fieldKey, value: f.value })),
                note:
                    "These are property-level credentials, not a specific guest's code. This lookup is " +
                    "logged against the caller. Guest-specific door codes are generated per reservation and " +
                    "live in the smart-lock screen, not here.",
            },
        };
    },

    async search_knowledge(args, ctx) {
        requireCapability(ctx.viewer, "property.knowledge", "Knowledge search is not available to you.");
        const query = String(args.query || "").trim();
        if (!query) return { data: { note: "Empty query." }, rowCount: 0 };

        const retrieval = new RetrievalService();
        let groupId: number | null = null;
        const scopeId = asId(args.listingId);
        if (scopeId) {
            // Resolved with the same raw-SQL path the other tools use. Going through
            // ListingGroupService would pull in a TypeORM repository, which breaks in
            // ts-node contexts where the entity class and the registered metadata come
            // from different builds.
            const { listing } = await resolveOne({ listingId: scopeId });
            groupId = listing?.groupId ?? scopeId;
        }

        const [kb, docs, facts] = await Promise.all([
            retrieval.retrieveKb(groupId, query, { k: 5 }).catch(() => ({ external: [], internal: [] })),
            retrieval.retrieveDocs(groupId, query, { k: 4 }).catch(() => ({ external: [], internal: [] })),
            retrieval.retrieveFacts(groupId, query, { k: 5 }).catch(() => []),
        ]);

        const hits = [
            ...kb.internal.map((h) => ({ source: "knowledge base (staff only)", text: h.text, score: h.sim })),
            ...kb.external.map((h) => ({ source: "knowledge base", text: h.text, score: h.sim })),
            ...docs.internal.map((h) => ({ source: "house manual (staff only)", text: h.text, score: h.sim })),
            ...docs.external.map((h) => ({ source: "house manual", text: h.text, score: h.sim })),
            ...(facts as any[]).map((f) => ({ source: `learned answer (${f.scope})`, text: f.answer, score: f.sim })),
        ].sort((a, b) => b.score - a.score);

        return {
            data: {
                hits: hits.slice(0, 12),
                note:
                    hits.length === 0
                        ? "Nothing matched semantically. Say you could not find it rather than guessing — and " +
                          "suggest the user add it to the property's knowledge base."
                        : "Ranked by semantic similarity. Low scores mean a loose match; do not present a " +
                          "loose match as a confirmed fact.",
            },
            rowCount: hits.length,
        };
    },

    async search_history(args, ctx) {
        requireCapability(ctx.viewer, "property.knowledge", "History search is not available to you.");

        const raw = String(args.query || "").trim();
        const terms = keywords(raw);
        if (!terms.length) {
            return { data: { note: "Give me at least one keyword to search for." }, rowCount: 0 };
        }
        // A door code found in an old guest message is still a credential, so make the
        // audit row say so.
        if (/\b(code|codes|password|passcode|combo|combination|lockbox|wifi|key ?pad)\b/i.test(raw)) {
            ctx.returnedCredentials = true;
        }

        let listingId: number | null = asId(args.listingId);
        let listingName: string | null = null;
        if (!listingId && args.property) {
            const { listing, ambiguous } = await resolveOne({ property: args.property });
            if (!listing) return ambiguityResult(ambiguous);
            listingId = listing.listingId;
            listingName = listing.name;
        }
        const groupIds = new Set<number>();
        if (listingId) {
            groupIds.add(listingId);
            const siblings: any[] = await appDatabase
                .query(
                    `SELECT listingId FROM listing_group_map
                     WHERE groupId = (SELECT groupId FROM listing_group_map WHERE listingId = ? LIMIT 1)`,
                    [listingId]
                )
                .catch(() => []);
            for (const s of siblings) groupIds.add(Number(s.listingId));
        }

        const months = Math.min(60, Math.max(1, Math.round(Number(args.months) || 24)));
        const since = new Date(Date.now() - months * 31 * DAY_MS);
        const ids = [...groupIds];
        const anyTerm = (col: string) => `(${terms.map(() => `${col} LIKE ?`).join(" OR ")})`;
        const likes = terms.map((t) => `%${t}%`);

        // inbox_messages has no index on listingId, so an unscoped search would scan the
        // whole table. Require a property for the message search and lean on sentAt.
        const messages: any[] = ids.length
            ? await appDatabase
                  .query(
                      `SELECT m.sentAt, m.direction, m.senderType, m.senderName, m.isAutomatic,
                              m.body, m.note
                       FROM inbox_messages m
                       WHERE m.listingId IN (${ids.map(() => "?").join(",")})
                         AND m.sentAt >= ?
                         AND (${anyTerm("m.body")} OR ${anyTerm("m.note")})
                       ORDER BY m.sentAt DESC
                       LIMIT 25`,
                      [...ids, since, ...likes, ...likes]
                  )
                  .catch(() => [])
            : [];

        const issueWhere: string[] = ["i.deleted_at IS NULL", "i.created_at >= ?"];
        const issueParams: any[] = [since];
        if (ids.length) {
            issueWhere.push(
                `CAST(NULLIF(TRIM(i.listing_id),'') AS UNSIGNED) IN (${ids.map(() => "?").join(",")})`
            );
            issueParams.push(...ids);
        }
        const textCols = ["i.issue_description", "i.next_steps", "i.resolution", "i.guest_relations_resolution"];
        issueWhere.push(`(${textCols.map((c) => anyTerm(c)).join(" OR ")})`);
        for (const _ of textCols) issueParams.push(...likes);

        const [tickets, internal]: any[] = await Promise.all([
            appDatabase
                .query(
                    `SELECT i.id, i.ai_short_title, i.issue_description, i.next_steps, i.resolution,
                            i.guest_relations_resolution, i.listing_name, i.created_at
                     FROM issues i
                     WHERE ${issueWhere.join(" AND ")}
                     ORDER BY i.created_at DESC LIMIT 15`,
                    issueParams
                )
                .catch(() => []),
            ids.length
                ? appDatabase
                      .query(
                          `SELECT tm.content, tm.user_name, tm.message_timestamp, i.id AS issueId,
                                  i.listing_name
                           FROM thread_messages tm
                           JOIN issues i ON i.id = tm.gr_task_id
                           WHERE i.deleted_at IS NULL
                             AND CAST(NULLIF(TRIM(i.listing_id),'') AS UNSIGNED) IN (${ids.map(() => "?").join(",")})
                             AND tm.message_timestamp >= ?
                             AND ${anyTerm("tm.content")}
                           ORDER BY tm.message_timestamp DESC LIMIT 15`,
                          [...ids, since, ...likes]
                      )
                      .catch(() => [])
                : [],
        ]);

        const hits: any[] = [];
        for (const m of messages) {
            const text = [m.body, m.note].filter(Boolean).join(" — ");
            hits.push({
                source:
                    Number(m.isAutomatic) === 1
                        ? "automated message sent to guests"
                        : m.direction === "incoming"
                          ? "message from a guest"
                          : "message a teammate sent a guest",
                who: m.senderName || m.senderType || null,
                when: m.sentAt,
                text: snippet(text, terms),
                matched: matchedTerms(text, terms),
            });
        }
        for (const t of tickets) {
            const text = [t.ai_short_title, t.issue_description, t.next_steps, t.resolution, t.guest_relations_resolution]
                .filter(Boolean)
                .join(" — ");
            hits.push({
                source: `ticket ${t.id}${t.listing_name ? ` (${t.listing_name})` : ""}`,
                who: null,
                when: t.created_at,
                text: snippet(text, terms),
                matched: matchedTerms(text, terms),
            });
        }
        for (const tm of internal) {
            hits.push({
                source: `internal discussion on ticket ${tm.issueId}`,
                who: tm.user_name || null,
                when: tm.message_timestamp,
                text: snippet(tm.content, terms),
                matched: matchedTerms(tm.content, terms),
            });
        }
        // Most keywords matched first, then most recent — an old message that mentions
        // every term beats a recent one that happens to contain "code".
        hits.sort(
            (a, b) => b.matched.length - a.matched.length || new Date(b.when).getTime() - new Date(a.when).getTime()
        );
        // With several keywords, a hit on only one of them is usually noise ("lock" in
        // "o'clock"). Drop those, but only when better matches exist.
        const bestMatch = hits.length ? hits[0].matched.length : 0;
        const ranked = terms.length > 1 && bestMatch > 1 ? hits.filter((h) => h.matched.length > 1) : hits;

        return {
            data: {
                searchedFor: terms,
                property: listingName ?? (listingId ? `listing ${listingId}` : "all properties"),
                monthsSearched: months,
                hits: ranked.slice(0, 20),
                note:
                    ranked.length === 0
                        ? "Nothing in the message or ticket history mentions these words" +
                          (ids.length ? " for this property" : "") +
                          ". Try different keywords, widen months, or drop the property scope before " +
                          "concluding it is not recorded anywhere."
                        : "This is what people wrote at the time, not a verified property record. An " +
                          "automated guest template is reliable for current procedure; a one-off message " +
                          "from months ago may be stale. Say which one you are quoting and how old it is, " +
                          "and never present a code found here as confirmed without saying where it came from." +
                          (ids.length ? "" : " Ticket text only — scope to a property to include guest messages."),
            },
            rowCount: ranked.length,
        };
    },

    async my_activity(args, ctx) {
        requireCapability(ctx.viewer, "activity.self", "Activity data is not available to you.");
        // The model has repeatedly answered "how many replies did <colleague> send" by
        // calling this tool and reporting the caller's figures, which reads as the
        // colleague's. Instructions alone did not hold, so the check lives here: naming
        // someone else makes this a team_activity question, and team_activity is gated.
        if (!isSelf(args.about, ctx.viewer)) {
            requireCapability(
                ctx.viewer,
                "activity.team",
                `These numbers are only ever the caller's own, and the question is about ${String(
                    args.about
                ).slice(0, 60)}. Per-person numbers for other employees are admin-only — say that plainly ` +
                    "rather than reporting the caller's own figures."
            );
            return {
                data: {
                    note:
                        "This tool only returns the caller's own numbers. You have team access, so use " +
                        "team_activity for another person instead of this.",
                },
                rowCount: 0,
            };
        }
        const { userId, email } = ctx.viewer;
        if (!userId) {
            return {
                data: { note: "Your SecureStay user record could not be resolved, so I cannot pull your numbers." },
                rowCount: 0,
            };
        }
        const days = clampDays(args.days, 7, 90);
        const since = new Date(Date.now() - days * DAY_MS);
        const userKey = (email || "").toLowerCase();

        const [replies, grades, hours, tasks] = await Promise.all([
            appDatabase.query(
                `SELECT DATE(sentAt) AS day, COUNT(*) AS replies,
                        COUNT(DISTINCT threadId) AS threads
                 FROM inbox_messages
                 WHERE sentByUserId = ? AND direction = 'outgoing'
                   AND COALESCE(isAutomatic,0) = 0 AND sentAt >= ?
                 GROUP BY DATE(sentAt) ORDER BY day DESC`,
                [userId, since]
            ),
            userKey
                ? appDatabase.query(
                      `SELECT date, activeMinutes, workloadGrade, qualityGrade,
                              ssRepliesCount, quoMessagesCount, callsCount, summary
                       FROM admin_workday_grades
                       WHERE userKey = ? AND date >= DATE(?)
                       ORDER BY date DESC LIMIT 90`,
                      [userKey, since]
                  )
                : Promise.resolve([]),
            appDatabase.query(
                `SELECT DATE(clockInAt) AS day,
                        ROUND(SUM(COALESCE(computedDuration, duration))/3600, 2) AS hours
                 FROM time_entries
                 WHERE userId = ? AND clockInAt >= ? AND deletedAt IS NULL
                 GROUP BY DATE(clockInAt) ORDER BY day DESC`,
                [userId, since]
            ),
            appDatabase.query(
                `SELECT status, COUNT(*) AS n FROM assigned_tasks
                 WHERE assignee_id = ? GROUP BY status`,
                [userId]
            ),
        ]);

        const totalReplies = (replies as any[]).reduce((s, r) => s + Number(r.replies || 0), 0);
        return {
            data: {
                you: ctx.viewer.userName,
                windowDays: days,
                guestReplies: { total: totalReplies, byDay: replies },
                effortGrades: grades,
                hoursByDay: hours,
                tasksByStatus: tasks,
                note:
                    `These are ${ctx.viewer.userName || "the caller"}'s own numbers and nobody else's. If the ` +
                    "question named a different person, do not present these as theirs — say you can only see " +
                    "your own. guestReplies counts non-automatic outgoing SecureStay inbox messages. " +
                    "effortGrades already includes Quo calls and SMS.",
            },
            rowCount: (replies as any[]).length,
        };
    },

    async team_activity(args, ctx) {
        requireCapability(
            ctx.viewer,
            "activity.team",
            "Per-person numbers for other employees are admin-only. I can show you your own with my_activity."
        );
        const days = clampDays(args.days, 7, 90);
        const since = new Date(Date.now() - days * DAY_MS);
        const employee = (args.employee || "").toString().trim();
        const like = `%${employee}%`;

        const replies: any[] = await appDatabase.query(
            `SELECT u.id AS userId,
                    TRIM(CONCAT(COALESCE(u.firstName,''),' ',COALESCE(u.lastName,''))) AS name,
                    COUNT(*) AS replies, COUNT(DISTINCT m.threadId) AS threads
             FROM inbox_messages m
             JOIN users u ON u.id = m.sentByUserId AND u.deletedAt IS NULL
             WHERE m.direction = 'outgoing' AND COALESCE(m.isAutomatic,0) = 0
               AND m.sentAt >= ?
               ${employee ? "AND (u.firstName LIKE ? OR u.lastName LIKE ? OR u.email LIKE ?)" : ""}
             GROUP BY u.id, name
             ORDER BY replies DESC LIMIT 60`,
            employee ? [since, like, like, like] : [since]
        );

        const grades: any[] = await appDatabase.query(
            `SELECT userKey, displayName,
                    ROUND(AVG(activeMinutes)) AS avgActiveMinutes,
                    SUM(ssRepliesCount) AS ssReplies,
                    SUM(quoMessagesCount) AS quoMessages,
                    SUM(callsCount) AS calls,
                    COUNT(*) AS gradedDays
             FROM admin_workday_grades
             WHERE date >= DATE(?)
               ${employee ? "AND (userKey LIKE ? OR displayName LIKE ?)" : ""}
             GROUP BY userKey, displayName
             ORDER BY ssReplies DESC LIMIT 60`,
            employee ? [since, like, like] : [since]
        );

        const issues: any[] = await appDatabase.query(
            `SELECT completed_by AS name, COUNT(*) AS ticketsCompleted
             FROM issues
             WHERE deleted_at IS NULL AND completed_by IS NOT NULL AND completed_by <> ''
               AND completed_at >= ?
               ${employee ? "AND completed_by LIKE ?" : ""}
             GROUP BY completed_by ORDER BY ticketsCompleted DESC LIMIT 60`,
            employee ? [since, like] : [since]
        );

        return {
            data: {
                windowDays: days,
                guestRepliesByUser: replies,
                effortByUser: grades,
                ticketsCompletedByUser: issues,
                note:
                    "Attribution is by explicit user id where available (guestRepliesByUser) and by name " +
                    "elsewhere (ticketsCompletedByUser), so name-based rows can miss renames. " +
                    "effortByUser is keyed on email and already blends Quo and SecureStay activity.",
            },
            rowCount: replies.length,
        };
    },

    async open_issues(args, ctx) {
        requireCapability(ctx.viewer, "ops.read", "Ticket data is not available to you.");
        const days = clampDays(args.days, 30, 180);
        const since = new Date(Date.now() - days * DAY_MS);
        const onlyOpen = args.onlyOpen !== false;

        let listingId: number | null = asId(args.listingId);
        if (!listingId && args.property) {
            const { listing, ambiguous } = await resolveOne({ property: args.property });
            if (!listing) return ambiguityResult(ambiguous);
            listingId = listing.listingId;
        }

        const where: string[] = ["i.deleted_at IS NULL"];
        const params: any[] = [];
        if (listingId) {
            // issues.listing_id is a VARCHAR of the numeric listing id.
            where.push("CAST(NULLIF(TRIM(i.listing_id),'') AS UNSIGNED) = ?");
            params.push(listingId);
        }
        if (args.category) {
            where.push("i.category LIKE ?");
            params.push(`%${args.category}%`);
        }
        if (args.assignee) {
            where.push("(i.assignee LIKE ? OR i.completed_by LIKE ?)");
            params.push(`%${args.assignee}%`, `%${args.assignee}%`);
        }
        if (onlyOpen) {
            where.push("(i.completed_at IS NULL AND COALESCE(i.status,'') NOT IN ('Completed','Cancelled','Closed'))");
        }

        const filters = where.join(" AND ");
        // The 40 detail rows are a sample, so counting them would answer "which
        // category is worst" with whatever happened to be most recent. Aggregate over
        // the whole window separately, plus the preceding window of equal length so
        // "is this worse than last month" has something real behind it.
        const prevSince = new Date(since.getTime() - days * DAY_MS);
        const [rows, byCategory, previousByCategory]: any[] = await Promise.all([
            appDatabase.query(
                `SELECT i.id, i.ai_short_title, i.issue_description, i.category, i.status, i.gr_status,
                        i.listing_name, i.guest_name, i.assignee, i.completed_by,
                        i.check_in_date, i.created_at, i.completed_at, i.next_steps
                 FROM issues i
                 WHERE ${filters} AND i.created_at >= ?
                 ORDER BY i.created_at DESC LIMIT 40`,
                [...params, since]
            ),
            appDatabase.query(
                `SELECT COALESCE(NULLIF(TRIM(i.category),''), 'Uncategorized') AS category, COUNT(*) AS tickets
                 FROM issues i
                 WHERE ${filters} AND i.created_at >= ?
                 GROUP BY category ORDER BY tickets DESC`,
                [...params, since]
            ),
            appDatabase.query(
                `SELECT COALESCE(NULLIF(TRIM(i.category),''), 'Uncategorized') AS category, COUNT(*) AS tickets
                 FROM issues i
                 WHERE ${filters} AND i.created_at >= ? AND i.created_at < ?
                 GROUP BY category ORDER BY tickets DESC`,
                [...params, prevSince, since]
            ),
        ]);
        const sum = (list: any[]) => list.reduce((s, r) => s + Number(r.tickets || 0), 0);

        return {
            data: {
                windowDays: days,
                onlyOpen,
                issues: rows.map((r) => ({
                    id: r.id,
                    title: r.ai_short_title || String(r.issue_description || "").slice(0, 120),
                    description: String(r.issue_description || "").slice(0, 600),
                    category: r.category,
                    status: r.status,
                    grStatus: r.gr_status,
                    property: r.listing_name,
                    guest: r.guest_name,
                    assignee: r.assignee,
                    completedBy: r.completed_by,
                    checkIn: r.check_in_date,
                    createdAt: r.created_at,
                    completedAt: r.completed_at,
                    nextSteps: r.next_steps ? String(r.next_steps).slice(0, 400) : null,
                })),
                totals: {
                    windowTickets: sum(byCategory),
                    byCategory,
                    previousWindowTickets: sum(previousByCategory),
                    previousByCategory,
                },
                note:
                    "`issues` is a sample capped at 40 rows, newest first — never count it to answer 'how many' " +
                    "or 'which category is worst'. Use `totals` for that: it covers the whole window, and " +
                    "`previousByCategory` covers the equally long window immediately before it, which is what to " +
                    "compare against. Narrow by property or category to see more detail rows.",
            },
            rowCount: rows.length,
        };
    },

    async reservation_lookup(args, ctx) {
        requireCapability(ctx.viewer, "ops.read", "Reservation data is not available to you.");
        const where: string[] = ["1=1"];
        const params: any[] = [];

        if (args.guest) {
            where.push("(r.guestName LIKE ? OR r.guestEmail LIKE ? OR r.phone LIKE ?)");
            params.push(`%${args.guest}%`, `%${args.guest}%`, `%${args.guest}%`);
        }
        if (args.reservationId) {
            where.push("(r.reservationId = ? OR r.channelReservationId = ?)");
            params.push(String(args.reservationId), String(args.reservationId));
        }
        let listingId: number | null = asId(args.listingId);
        if (!listingId && args.property) {
            const { listing, ambiguous } = await resolveOne({ property: args.property });
            if (!listing) return ambiguityResult(ambiguous);
            listingId = listing.listingId;
        }
        if (listingId) {
            where.push("r.listingMapId = ?");
            params.push(listingId);
        }
        if (args.arrivingWithinDays) {
            const d = clampDays(args.arrivingWithinDays, 7, 90);
            where.push("r.arrivalDate >= CURDATE() AND r.arrivalDate < DATE_ADD(CURDATE(), INTERVAL ? DAY)");
            params.push(d);
        }
        if (where.length === 1) {
            return {
                data: { note: "Give me a guest name, confirmation code, property, or arrival window to search on." },
                rowCount: 0,
            };
        }

        const rows: any[] = await appDatabase.query(
            `SELECT r.id, r.reservationId, r.listingName, r.listingMapId, r.guestName, r.guestEmail,
                    r.phone, r.arrivalDate, r.departureDate, r.nights, r.numberOfGuests,
                    r.status, r.channelName, r.totalPrice, r.currency
             FROM reservation_info r
             WHERE ${where.join(" AND ")}
             ORDER BY r.arrivalDate DESC LIMIT 25`,
            params
        );

        return {
            data: {
                reservations: rows,
                note: "Capped at 25, most recent arrival first. Guest contact details are PII — use them for the task at hand, do not restate them unnecessarily.",
            },
            rowCount: rows.length,
        };
    },

    async my_tasks(args, ctx) {
        requireCapability(ctx.viewer, "activity.self", "Task data is not available to you.");
        if (!ctx.viewer.userId) {
            return { data: { note: "Your user record could not be resolved, so I cannot list your tasks." }, rowCount: 0 };
        }
        const includeCompleted = args.includeCompleted === true;
        const rows: any[] = await appDatabase.query(
            `SELECT id, title, description, status, taskType, dueDate, isRecurring, createdAt
             FROM assigned_tasks
             WHERE assignee_id = ?
               ${includeCompleted ? "" : "AND COALESCE(status,'') NOT IN ('Completed','Cancelled')"}
             ORDER BY (dueDate IS NULL), dueDate ASC, createdAt DESC
             LIMIT 50`,
            [ctx.viewer.userId]
        );
        return { data: { tasks: rows, includeCompleted }, rowCount: rows.length };
    },

    async vendor_lookup(args, ctx) {
        requireCapability(ctx.viewer, "ops.read", "Vendor data is not available to you.");
        const where: string[] = ["1=1"];
        const params: any[] = [];
        if (args.city) {
            where.push("city LIKE ?");
            params.push(`%${args.city}%`);
        }
        if (args.category) {
            where.push("(category LIKE ? OR role LIKE ?)");
            params.push(`%${args.category}%`, `%${args.category}%`);
        }
        if (args.name) {
            where.push("(vendorName LIKE ? OR normalizedName LIKE ?)");
            params.push(`%${args.name}%`, `%${args.name}%`);
        }
        const rows: any[] = await appDatabase.query(
            `SELECT vendorName, phone, email, category, city, role, useCount, lastUsedAt, notes
             FROM ir_vendor_memory
             WHERE ${where.join(" AND ")}
             ORDER BY useCount DESC, lastUsedAt DESC LIMIT 25`,
            params
        );
        return {
            data: {
                vendors: rows,
                note: "Ordered by how often we have actually used them. useCount 0 means unproven.",
            },
            rowCount: rows.length,
        };
    },

    async upsell_policy(args, ctx) {
        requireCapability(ctx.viewer, "ops.read", "Upsell policy is not available to you.");
        const { listing, ambiguous } = await resolveOne(args);
        if (!listing) return ambiguityResult(ambiguous);
        const rows: any[] = await appDatabase
            .query(
                `SELECT serviceType, description, internalNotes, chargeType,
                        pmFee, actualFee, processingFee, upsellFee, taxable, sdto
                 FROM upsell_property_config
                 WHERE listingId IN (?, ?) LIMIT 25`,
                [listing.listingId, listing.groupId ?? listing.listingId]
            )
            .catch(() => []);
        return {
            data: {
                property: listing,
                policies: rows,
                note:
                    rows.length === 0
                        ? "No per-property upsell config found; fall back to the portfolio default and say it is the default."
                        : "internalNotes are staff-only context, not guest-facing copy.",
            },
            rowCount: rows.length,
        };
    },

    async expense_summary(args, ctx) {
        requireCapability(ctx.viewer, "accounting.read", "Expense data is not available to you.");
        const months = Math.min(12, Math.max(1, Math.round(Number(args.months) || 3)));
        let listingId: number | null = asId(args.listingId);
        if (!listingId && args.property) {
            const { listing, ambiguous } = await resolveOne({ property: args.property });
            if (!listing) return ambiguityResult(ambiguous);
            listingId = listing.listingId;
        }

        // expense.expenseDate is a 'yyyy-MM-dd' VARCHAR, so the window is a
        // string comparison and the month is a prefix — matching how the rest of
        // the accounting code treats this column.
        const fromDate = new Date(Date.now() - months * 31 * DAY_MS).toISOString().slice(0, 10);
        const params: any[] = [fromDate];
        if (listingId) params.push(listingId);

        const rows: any[] = await appDatabase.query(
            `SELECT LEFT(e.expenseDate, 7) AS month,
                    COALESCE(NULLIF(TRIM(e.categories),''), 'Uncategorized') AS category,
                    ROUND(SUM(ABS(e.amount)), 2) AS total,
                    COUNT(*) AS lineItems
             FROM expense e
             WHERE COALESCE(e.isDeleted, 0) = 0
               AND e.expenseDate >= ?
               ${listingId ? "AND e.listingMapId = ?" : ""}
             GROUP BY month, category
             ORDER BY month DESC, total DESC
             LIMIT 150`,
            params
        );

        // expense.categories holds a JSON array of category ids ("[18666]"), which is
        // meaningless in an answer, so swap in the names before the model sees it.
        const ids = new Set<number>();
        for (const r of rows) {
            for (const m of String(r.category).matchAll(/\d+/g)) ids.add(Number(m[0]));
        }
        const names = new Map<number, string>();
        if (ids.size) {
            const list = [...ids];
            const cats: any[] = await appDatabase
                .query(
                    `SELECT id, hostawayId, categoryName FROM category
                     WHERE id IN (${list.map(() => "?").join(",")})
                        OR hostawayId IN (${list.map(() => "?").join(",")})`,
                    [...list, ...list]
                )
                .catch(() => []);
            for (const c of cats) {
                if (c.categoryName == null) continue;
                names.set(Number(c.id), String(c.categoryName));
                if (c.hostawayId != null) names.set(Number(c.hostawayId), String(c.categoryName));
            }
        }
        const labelled = rows.map((r) => {
            const raw = String(r.category);
            const found = [...raw.matchAll(/\d+/g)]
                .map((m) => names.get(Number(m[0])))
                .filter(Boolean) as string[];
            return {
                ...r,
                category: found.length ? found.join(", ") : raw === "Uncategorized" ? raw : `Uncategorized (${raw})`,
            };
        });

        return {
            data: {
                months,
                listingId,
                byMonthAndCategory: labelled,
                note:
                    "Absolute expense amounts from the expense ledger. The current month is partial — " +
                    "never compare it to a complete month without saying so. Payroll is not included. " +
                    "A category shown as 'Uncategorized (...)' had an id with no matching category name; " +
                    "report it as uncategorized rather than quoting the id.",
            },
            rowCount: rows.length,
        };
    },

    async employee_directory(args, ctx) {
        requireCapability(ctx.viewer, "employee.directory", "The employee directory is not available to you.");
        const where: string[] = ["u.deletedAt IS NULL"];
        const params: any[] = [];
        if (args.name) {
            where.push("(u.firstName LIKE ? OR u.lastName LIKE ? OR u.email LIKE ?)");
            params.push(`%${args.name}%`, `%${args.name}%`, `%${args.name}%`);
        }
        if (args.department) {
            where.push("(e.department LIKE ? OR d.name LIKE ?)");
            params.push(`%${args.department}%`, `%${args.department}%`);
        }
        // Deliberately no hourly_rate / bonuses / payment_* / payroll_notes here.
        const rows: any[] = await appDatabase.query(
            `SELECT DISTINCT
                    TRIM(CONCAT(COALESCE(u.firstName,''),' ',COALESCE(u.lastName,''))) AS name,
                    u.email, u.isActive,
                    e.job_title AS jobTitle, e.department, e.is_active AS employeeActive
             FROM users u
             LEFT JOIN employees e ON e.user_id = u.id
             LEFT JOIN user_departments ud ON ud.userId = u.id
             LEFT JOIN departments d ON d.id = ud.departmentId
             WHERE ${where.join(" AND ")}
             ORDER BY COALESCE(u.isActive, 0) DESC, name
             LIMIT 81`,
            params
        );
        const truncated = rows.length > 80;
        return {
            data: {
                employees: rows.slice(0, 80),
                note:
                    "Directory only — no compensation data is available through this tool at any access level. " +
                    "isActive/employeeActive of 0 means the account is deactivated: do not present those people " +
                    "as current staff or as someone to contact." +
                    (truncated
                        ? " This list was cut off at 80 people, so it is not the whole company — narrow by name or department."
                        : ""),
            },
            rowCount: Math.min(rows.length, 80),
        };
    },

    async payroll_lookup(args, ctx) {
        requireCapability(
            ctx.viewer,
            "payroll.read",
            "Pay rates and timesheets are restricted to super admins. That includes the caller's own " +
                "pay, so do not offer to look up their hourly rate — offer their own hours clocked instead."
        );
        const days = clampDays(args.days, 14, 90);
        const since = new Date(Date.now() - days * DAY_MS);
        const employee = (args.employee || "").toString().trim();
        const like = `%${employee}%`;

        const rows: any[] = await appDatabase.query(
            `SELECT TRIM(CONCAT(COALESCE(u.firstName,''),' ',COALESCE(u.lastName,''))) AS name,
                    u.email, e.job_title AS jobTitle, e.department,
                    e.hourly_rate AS hourlyRate,
                    ROUND(COALESCE(SUM(COALESCE(t.computedDuration, t.duration)),0)/3600, 2) AS hoursInWindow
             FROM users u
             LEFT JOIN employees e ON e.user_id = u.id
             LEFT JOIN time_entries t
                    ON t.userId = u.id AND t.clockInAt >= ? AND t.deletedAt IS NULL
             WHERE u.deletedAt IS NULL
               ${employee ? "AND (u.firstName LIKE ? OR u.lastName LIKE ? OR u.email LIKE ?)" : ""}
             GROUP BY u.id, name, u.email, e.job_title, e.department, e.hourly_rate
             ORDER BY name LIMIT 60`,
            employee ? [since, like, like, like] : [since]
        );

        return {
            data: {
                windowDays: days,
                payroll: rows,
                note:
                    "Super-admin only and audited. hoursInWindow is clocked time, not approved payroll — " +
                    "do not compute final pay from it.",
            },
            rowCount: rows.length,
        };
    },

    async portfolio_overview(_args, ctx) {
        requireCapability(ctx.viewer, "property.knowledge", "Portfolio data is not available to you.");
        const [counts, cities, tickets] = await Promise.all([
            appDatabase.query(
                `SELECT COUNT(DISTINCT COALESCE(lgm.groupId, li.id)) AS properties
                 FROM listing_info li
                 LEFT JOIN listing_group_map lgm ON lgm.listingId = li.id
                 WHERE li.deletedAt IS NULL`
            ),
            appDatabase.query(
                `SELECT li.city, li.state, COUNT(DISTINCT COALESCE(lgm.groupId, li.id)) AS properties
                 FROM listing_info li
                 LEFT JOIN listing_group_map lgm ON lgm.listingId = li.id
                 WHERE li.deletedAt IS NULL AND li.city IS NOT NULL AND TRIM(li.city) <> ''
                 GROUP BY li.city, li.state
                 ORDER BY properties DESC LIMIT 40`
            ),
            appDatabase.query(
                `SELECT COALESCE(NULLIF(TRIM(category),''),'Uncategorized') AS category, COUNT(*) AS open
                 FROM issues
                 WHERE deleted_at IS NULL AND completed_at IS NULL
                   AND COALESCE(status,'') NOT IN ('Completed','Cancelled','Closed')
                 GROUP BY category ORDER BY open DESC LIMIT 20`
            ),
        ]);
        return {
            data: {
                activeProperties: (counts as any[])[0]?.properties ?? null,
                byCity: cities,
                openTicketsByCategory: tickets,
                note: "Property counts collapse channel-split listings (an Airbnb and Vrbo copy count once).",
            },
        };
    },
};

export function getToolHandler(name: string): Handler | undefined {
    return handlers[name];
}

export const TOOL_NAMES = Object.keys(handlers);
