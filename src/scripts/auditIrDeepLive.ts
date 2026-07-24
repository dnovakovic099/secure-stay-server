/**
 * Deep live IR quality audit — hunts null phones, wrong-market numbers,
 * "null" string recommendations, orphan listings, and bad v6 suggestions.
 *
 * Usage on EC2:
 *   npx ts-node src/scripts/auditIrDeepLive.ts            # DB-only (fast)
 *   NODE_ENV=production node dist/out-tsc/scripts/auditIrDeepLive.js --force-suggest
 */
import "dotenv/config";
import mysql from "mysql2/promise";

type Finding = {
    severity: "critical" | "high" | "medium" | "ok";
    code: string;
    msg: string;
    issueId?: number;
    evidence?: any;
};

const CHI_NPAS = new Set(["312", "773", "872", "708", "847", "630", "815", "464"]);
const TPA_NPAS = new Set(["813", "727", "941", "352", "863", "239"]);
const CHI_CITIES = new Set(
    ["chicago", "elmwood park", "lombard", "evanston", "oak park", "naperville", "schaumburg"].map((s) =>
        s.toLowerCase()
    )
);
const TPA_CITIES = new Set(
    ["tampa", "bradenton", "st. petersburg", "st petersburg", "largo", "clearwater", "madeira beach", "sarasota"].map(
        (s) => s.toLowerCase()
    )
);

function digits(phone: string | null | undefined): string | null {
    let d = String(phone || "").replace(/\D/g, "");
    // +17274523880 must become 7274523880, not a fake NPA "172".
    if (d.length >= 11 && d.startsWith("1")) d = d.slice(-10);
    else if (d.length > 10) d = d.slice(-10);
    return d.length === 10 ? d : null;
}

function npa(phone: string | null | undefined): string | null {
    const d = digits(phone);
    return d ? d.slice(0, 3) : null;
}

function cityRegion(city: string | null | undefined): "chi" | "tpa" | "other" | "unknown" {
    const c = String(city || "")
        .trim()
        .toLowerCase();
    if (!c || c === "(not specified)") return "unknown";
    if (CHI_CITIES.has(c) || c.includes("chicago")) return "chi";
    if (TPA_CITIES.has(c) || c.includes("tampa") || c.includes("petersburg")) return "tpa";
    return "other";
}

function phoneRegion(phone: string | null | undefined): "chi" | "tpa" | "other" | "unknown" {
    const a = npa(phone);
    if (!a) return "unknown";
    if (CHI_NPAS.has(a)) return "chi";
    if (TPA_NPAS.has(a)) return "tpa";
    return "other";
}

function extractPhones(text: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    // Prefer +1 / 1-prefixed NANP first so "+17274523880" does not yield NPA 172.
    const patterns = [
        /\+?1[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
        /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    ];
    for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
            const d = digits(m[0]);
            if (!d || seen.has(d)) continue;
            seen.add(d);
            out.push(m[0]);
        }
    }
    return out;
}

function isVendorLikeContact(c: any): boolean {
    const src = String(c?.source || "").toLowerCase();
    return src === "contact" || src === "poc" || src === "memory";
}

function parseJsonArray(raw: any): any[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
        const p = JSON.parse(String(raw));
        return Array.isArray(p) ? p : [];
    } catch {
        return [];
    }
}

async function main() {
    const forceSuggest = process.argv.includes("--force-suggest");
    const findings: Finding[] = [];
    const note = (severity: Finding["severity"], code: string, msg: string, extra?: Partial<Finding>) => {
        findings.push({ severity, code, msg, ...extra });
        console.log(`[${severity.toUpperCase()}] ${code}: ${msg}`);
    };

    const conn = await mysql.createConnection({
        host: process.env.DATABASE_URL,
        port: Number(process.env.DATABASE_PORT || 3306),
        user: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME,
        charset: "utf8mb4",
    });

    console.log("\n===== 1) VENDOR MEMORY QUALITY =====");
    const [memBad]: any = await conn.query(
        `SELECT
           SUM(phone IS NULL OR TRIM(phone) = '') AS null_phone,
           SUM(vendorName IS NULL OR TRIM(vendorName) = '' OR LOWER(vendorName) IN ('null','undefined')) AS bad_name,
           SUM(city IS NULL OR TRIM(city) = '' OR city = '(NOT SPECIFIED)' OR city = '(unknown city)') AS null_city,
           SUM(phone REGEXP '^(777|778|779|555|000)') AS bogus_npa,
           COUNT(*) AS total
         FROM ir_vendor_memory`
    );
    const mb = memBad?.[0] || {};
    note(Number(mb.null_phone) > 0 ? "high" : "ok", "mem_null_phone", `null/empty phones=${mb.null_phone}/${mb.total}`);
    note(Number(mb.bad_name) > 0 ? "critical" : "ok", "mem_bad_name", `bad vendorName=${mb.bad_name}`);
    note(Number(mb.null_city) > 0 ? "medium" : "ok", "mem_null_city", `null/unknown city rows=${mb.null_city}`);
    note(Number(mb.bogus_npa) > 0 ? "critical" : "ok", "mem_bogus", `bogus NPA phones=${mb.bogus_npa}`);

    const [dupes]: any = await conn.query(
        `SELECT normalizedName, city, category, COUNT(*) c, GROUP_CONCAT(id) ids,
                GROUP_CONCAT(IFNULL(phone,'∅') SEPARATOR ' | ') phones
         FROM ir_vendor_memory
         GROUP BY normalizedName, city, category
         HAVING c > 1
         ORDER BY c DESC
         LIMIT 20`
    );
    if (dupes?.length) {
        note("medium", "mem_dupes", `${dupes.length} duplicate (name,city,category) groups`);
        for (const d of dupes.slice(0, 8)) {
            console.log(`   dupe ${d.normalizedName}/${d.city}/${d.category} x${d.c} phones=[${d.phones}]`);
        }
    } else note("ok", "mem_dupes", "no duplicate groups");

    // Known good phones must not be null
    const [knownNull]: any = await conn.query(
        `SELECT id, vendorName, phone, city, category, source
         FROM ir_vendor_memory
         WHERE normalizedName IN ('ana','miguel','diana','rodolfo')
           AND (phone IS NULL OR TRIM(phone)='')
         LIMIT 20`
    );
    if (knownNull?.length) {
        note("critical", "known_null_phone", `${knownNull.length} Ana/Miguel/Diana/Rodolfo rows still have null phone`);
        for (const r of knownNull) console.log(`   #${r.id} ${r.vendorName} @ ${r.city} [${r.category}] src=${r.source}`);
    } else note("ok", "known_null_phone", "core portfolio phones all populated");

    console.log("\n===== 2) LATEST v6/v7 SUGGESTIONS — STATIC SCAN =====");
    const [sugs]: any = await conn.query(
        `SELECT s.id AS sid, s.issueId, s.primaryAction, s.recommendedContactsJson, s.promptVersion,
                s.generatedAt, s.warningsJson, s.confidence,
                i.category, i.listing_id, i.listing_name, i.ai_short_title,
                l.city AS listing_city, l.address AS listing_address, l.state AS listing_state
         FROM issue_ai_suggestions s
         INNER JOIN issues i ON i.id = s.issueId
         LEFT JOIN listing_info l ON l.id = CAST(NULLIF(TRIM(i.listing_id), '') AS UNSIGNED)
         WHERE s.promptVersion LIKE 'ir-copilot-v%'
           AND s.id IN (SELECT MAX(id) FROM issue_ai_suggestions GROUP BY issueId)
         ORDER BY s.generatedAt DESC
         LIMIT 80`
    );

    let nullInAction = 0;
    let wrongMarket = 0;
    let contactNullPhone = 0;
    let callWithoutPhone = 0;
    let orphanListing = 0;
    const badExamples: any[] = [];

    for (const s of sugs || []) {
        const pa = String(s.primaryAction || "");
        const city = s.listing_city || null;
        const region = cityRegion(city);
        const contacts = parseJsonArray(s.recommendedContactsJson);

        if (!s.listing_city && !s.listing_id) orphanListing += 1;
        else if (!s.listing_city && s.listing_id) {
            // listing_id present but join failed or city empty
            if (!s.listing_address) orphanListing += 1;
        }

        if (/\bnull\b/i.test(pa) || /undefined/i.test(pa) || /at null/i.test(pa) || /call null/i.test(pa)) {
            nullInAction += 1;
            badExamples.push({ kind: "null_in_action", issueId: s.issueId, pa: pa.slice(0, 160), city });
        }

        // "Call X at" / "Contact X at" without a phone-looking token
        if (/\b(call|contact)\b.+\bat\b/i.test(pa) && !extractPhones(pa).length && !/at\s+\(/i.test(pa)) {
            // allow "at listing" etc.
            if (!/\bat\s+(the\s+)?(listing|property|door|keypad)/i.test(pa)) {
                callWithoutPhone += 1;
                badExamples.push({ kind: "call_no_phone", issueId: s.issueId, pa: pa.slice(0, 160), city });
            }
        }

        for (const phone of extractPhones(pa)) {
            const pr = phoneRegion(phone);
            if (region === "chi" && pr === "tpa") {
                wrongMarket += 1;
                badExamples.push({
                    kind: "chi_vs_tpa",
                    issueId: s.issueId,
                    city,
                    phone,
                    pa: pa.slice(0, 160),
                    category: s.category,
                });
            }
            if (region === "tpa" && pr === "chi") {
                wrongMarket += 1;
                badExamples.push({
                    kind: "tpa_vs_chi",
                    issueId: s.issueId,
                    city,
                    phone,
                    pa: pa.slice(0, 160),
                    category: s.category,
                });
            }
        }

        for (const c of contacts.slice(0, 5)) {
            // Guest/owner cell phones are often out-of-market — only audit vendor-like rows.
            if (!isVendorLikeContact(c)) continue;
            const name = String(c?.name || "");
            const phone = c?.phone;
            if (/^null$/i.test(name) || name.trim() === "") {
                contactNullPhone += 1;
                badExamples.push({ kind: "contact_bad_name", issueId: s.issueId, contact: c });
            }
            if (phone == null || String(phone).trim() === "" || /^null$/i.test(String(phone))) {
                // rank-1 contact without phone is especially bad if primaryAction names them
                if (Number(c?.rank) === 1 && /clean|maint|handy|vendor/i.test(`${c?.role || ""} ${name}`)) {
                    contactNullPhone += 1;
                    badExamples.push({
                        kind: "rank1_null_phone",
                        issueId: s.issueId,
                        name,
                        role: c?.role,
                        city,
                        category: s.category,
                    });
                }
            } else {
                const pr = phoneRegion(phone);
                // Flag clear CHI↔TPA swaps; ignore generic "other" cell NPAs.
                if ((region === "chi" && pr === "tpa") || (region === "tpa" && pr === "chi")) {
                    wrongMarket += 1;
                    badExamples.push({
                        kind: "wrong_market_contact",
                        issueId: s.issueId,
                        city,
                        name,
                        phone,
                        npa: npa(phone),
                        source: c?.source,
                        category: s.category,
                    });
                }
            }
        }
    }

    note(nullInAction > 0 ? "critical" : "ok", "sug_null_text", `${nullInAction} actions contain null/undefined text`);
    note(wrongMarket > 0 ? "critical" : "ok", "sug_wrong_market", `${wrongMarket} wrong-market phone signals in actions/contacts`);
    note(contactNullPhone > 0 ? "high" : "ok", "sug_null_contact", `${contactNullPhone} rank1/name null-phone contact problems`);
    note(callWithoutPhone > 0 ? "high" : "ok", "sug_call_no_phone", `${callWithoutPhone} call/contact-at without phone`);
    note("ok", "sug_scanned", `scanned ${sugs?.length || 0} latest ir-copilot suggestions`);

    console.log("\n--- Bad examples (up to 25) ---");
    for (const ex of badExamples.slice(0, 25)) {
        console.log(JSON.stringify(ex));
    }

    console.log("\n===== 3) ORPHAN LISTING / CITY GAP =====");
    const [orphans]: any = await conn.query(
        `SELECT
           COUNT(*) AS n,
           SUM(l.id IS NULL) AS no_join,
           SUM(l.id IS NOT NULL AND (l.city IS NULL OR TRIM(l.city)='' OR l.city='(NOT SPECIFIED)')) AS empty_city,
           SUM(l.id IS NOT NULL AND l.city IS NOT NULL AND TRIM(l.city)<>'' AND l.city<>'(NOT SPECIFIED)') AS has_city
         FROM issues i
         LEFT JOIN listing_info l ON l.id = CAST(NULLIF(TRIM(i.listing_id), '') AS UNSIGNED)
         WHERE i.deleted_at IS NULL AND i.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)`
    );
    const o = orphans?.[0] || {};
    note(Number(o.no_join) > 100 ? "high" : "ok", "orphan_listing", `14d no_join=${o.no_join} empty_city=${o.empty_city} has_city=${o.has_city} n=${o.n}`);

    // Can name fallback recover?
    const [nameRecover]: any = await conn.query(
        `SELECT COUNT(*) AS c
         FROM issues i
         LEFT JOIN listing_info l ON l.id = CAST(NULLIF(TRIM(i.listing_id), '') AS UNSIGNED)
         WHERE i.deleted_at IS NULL
           AND i.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
           AND l.id IS NULL
           AND i.listing_name IS NOT NULL AND TRIM(i.listing_name) <> ''
           AND EXISTS (
             SELECT 1 FROM listing_info l2
             WHERE l2.internalListingName = i.listing_name
                OR l2.name = i.listing_name
                OR l2.externalListingName = i.listing_name
           )`
    );
    note(
        "ok",
        "name_recoverable",
        `${nameRecover?.[0]?.c || 0} orphan listing_id tickets recoverable via listing_name match`
    );

    console.log("\n===== 4) CHI/TPA OPEN TICKETS — CONTACT vs MARKET =====");
    const [openTickets]: any = await conn.query(
        `SELECT i.id, i.category, i.status, i.listing_id, i.listing_name,
                l.city, LEFT(l.address, 60) AS address,
                s.primaryAction, s.recommendedContactsJson, s.promptVersion
         FROM issues i
         INNER JOIN listing_info l ON l.id = CAST(NULLIF(TRIM(i.listing_id), '') AS UNSIGNED)
         LEFT JOIN issue_ai_suggestions s ON s.id = (
           SELECT MAX(s2.id) FROM issue_ai_suggestions s2 WHERE s2.issueId = i.id
         )
         WHERE i.deleted_at IS NULL
           AND i.status IN ('Pending','In Progress','New','Open','Scheduled')
           AND (
             LOWER(TRIM(l.city)) IN ('chicago','elmwood park','lombard','tampa','bradenton','st. petersburg','largo','clearwater','madeira beach')
           )
         ORDER BY i.id DESC
         LIMIT 40`
    );
    let openWrong = 0;
    for (const t of openTickets || []) {
        const region = cityRegion(t.city);
        const contacts = parseJsonArray(t.recommendedContactsJson);
        const pa = String(t.primaryAction || "");
        const vendorPhones = contacts.filter(isVendorLikeContact).map((c: any) => c?.phone).filter(Boolean);
        for (const phone of [...extractPhones(pa), ...vendorPhones]) {
            const pr = phoneRegion(phone);
            // Only clear CHI↔TPA swaps — guest/other NPAs and +1 parse artifacts are not actionable.
            if ((region === "chi" && pr === "tpa") || (region === "tpa" && pr === "chi")) {
                openWrong += 1;
                console.log(
                    JSON.stringify({
                        kind: "open_wrong_market",
                        issueId: t.id,
                        category: t.category,
                        city: t.city,
                        phone,
                        npa: npa(phone),
                        promptVersion: t.promptVersion,
                        pa: pa.slice(0, 140),
                    })
                );
            }
        }
        // flag "Ana null" style
        if (/ana\s+null|null\s+@|at\s+null/i.test(pa) || contacts.some((c: any) => /^null$/i.test(String(c?.phone || "")) || c?.phone == null && /ana/i.test(String(c?.name || "")) && Number(c?.rank) <= 2)) {
            note("critical", "ana_null_pattern", `issue #${t.id} shows Ana/null phone pattern`, { issueId: t.id, evidence: { pa: pa.slice(0, 120), contacts: contacts.slice(0, 3) } });
        }
    }
    note(openWrong > 0 ? "critical" : "ok", "open_wrong_market", `${openWrong} wrong-market signals on open CHI/TPA tickets`);

    console.log("\n===== 5) ESCALATION / MANAGERS =====");
    const [esc]: any = await conn.query(
        `SELECT COUNT(*) AS c FROM issues_updates
         WHERE deletedAt IS NULL AND updates LIKE 'GR refund/cancellation escalated%'
           AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );
    const [tasks]: any = await conn.query(
        `SELECT assignee_id, COUNT(*) c FROM assigned_tasks
         WHERE title LIKE 'Refund/cancel ·%' AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY assignee_id`
    );
    const [notes]: any = await conn.query(
        `SELECT type, COUNT(*) c FROM user_directed_notifications
         WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
           AND (type = 'escalation' OR type = 'gr_refund_escalation' OR title LIKE 'Refund/cancel ·%')
         GROUP BY type`
    );
    note("ok", "esc_logs_7d", `escalation timeline rows=${esc?.[0]?.c || 0}`);
    console.log("   tasks by assignee:", JSON.stringify(tasks || []));
    console.log("   notifications by type:", JSON.stringify(notes || []));

    const [jade]: any = await conn.query(
        `SELECT id, email, firstName, lastName FROM users
         WHERE deletedAt IS NULL AND isActive = 1
           AND (
             LOWER(firstName)='jade' OR LOWER(email) LIKE 'jade%@%' OR LOWER(email) LIKE '%jade%'
             OR LOWER(lastName)='jade' OR LOWER(CONCAT(firstName,' ',lastName)) LIKE '%jade%'
           )
         LIMIT 20`
    );
    if (!jade?.length) note("high", "jade_missing", "Jade still not resolvable in users — only Anj will be notified by default");
    else note("ok", "jade_found", `Jade users: ${jade.map((u: any) => `${u.firstName} ${u.lastName}<${u.email}>`).join("; ")}`);

    // Force-suggest path
    if (forceSuggest) {
        console.log("\n===== 6) FORCE-SUGGEST DEEP SAMPLE =====");
        process.env.NODE_ENV = process.env.NODE_ENV || "production";
        const { appDatabase } = require("../utils/database.util");
        const { IssueAIService } = require("../services/IssueAIService");
        if (!appDatabase.isInitialized) await appDatabase.initialize();
        const ai = new IssueAIService();

        const [samples]: any = await conn.query(
            `SELECT i.id, i.category, l.city, i.listing_name, i.listing_id
             FROM issues i
             LEFT JOIN listing_info l ON l.id = CAST(NULLIF(TRIM(i.listing_id), '') AS UNSIGNED)
             WHERE i.deleted_at IS NULL
               AND UPPER(TRIM(i.category)) IN ('SUPPLIES','PROPERTY ACCESS','REFUNDS','RESERVATION CHANGES','MAINTENANCE','CLEANLINESS')
             ORDER BY i.id DESC
             LIMIT 18`
        );

        let fsWrong = 0;
        let fsNull = 0;
        let fsOk = 0;
        for (const sample of samples || []) {
            if (!sample?.id) continue;
            try {
                const sug = await ai.suggest(Number(sample.id), { force: true });
                const pa = String(sug.primaryAction || "");
                const contacts = sug.recommendedContacts || [];
                const city = sample.city || (sug as any)?.listing?.city || null;
                const region = cityRegion(city);
                const phones = [
                    ...extractPhones(pa),
                    ...contacts.filter(isVendorLikeContact).filter((c: any) => c.phone).map((c: any) => c.phone),
                ];
                const issuesForRow: string[] = [];
                if (/\bnull\b|undefined/i.test(pa)) issuesForRow.push("null_in_action");
                for (const c of contacts.slice(0, 3)) {
                    if (
                        isVendorLikeContact(c) &&
                        !c.phone &&
                        Number(c.rank) === 1 &&
                        /clean|maint|vendor/i.test(`${c.role} ${c.name}`)
                    ) {
                        issuesForRow.push("rank1_null_phone");
                    }
                    if (/^null$/i.test(String(c.name || ""))) issuesForRow.push("name_null");
                }
                for (const phone of phones) {
                    const pr = phoneRegion(phone);
                    if (region === "chi" && pr === "tpa") issuesForRow.push(`wrong_phone_${npa(phone)}`);
                    if (region === "tpa" && pr === "chi") issuesForRow.push(`wrong_phone_${npa(phone)}`);
                }
                // Chicago must not recommend Ana without phone
                if (region === "chi" && /ana/i.test(pa) && !/\(773\)/.test(pa) && !extractPhones(pa).length) {
                    issuesForRow.push("ana_without_773");
                }
                if (issuesForRow.length) {
                    fsWrong += 1;
                    if (issuesForRow.some((x) => x.includes("null"))) fsNull += 1;
                    console.log(
                        JSON.stringify({
                            issueId: sample.id,
                            category: sample.category,
                            city,
                            listing: sample.listing_name,
                            pa: pa.slice(0, 180),
                            topContacts: contacts.slice(0, 3).map((c: any) => ({
                                rank: c.rank,
                                name: c.name,
                                phone: c.phone,
                                source: c.source,
                                role: c.role,
                            })),
                            portfolio: (sug.portfolioVendors || []).slice(0, 3).map((v: any) => `${v.name} ${v.phone} @ ${v.city}`),
                            issues: issuesForRow,
                        })
                    );
                } else {
                    fsOk += 1;
                }
            } catch (err: any) {
                fsWrong += 1;
                console.log(JSON.stringify({ issueId: sample.id, error: err?.message || String(err) }));
            }
        }
        note(fsWrong > 0 ? "critical" : "ok", "force_suggest", `force-suggest ok=${fsOk} flagged=${fsWrong} nullish=${fsNull}`);
        try {
            await appDatabase.destroy();
        } catch {
            /* ignore */
        }
    }

    console.log("\n========== DEEP AUDIT SUMMARY ==========");
    const crit = findings.filter((f) => f.severity === "critical");
    const high = findings.filter((f) => f.severity === "high");
    const medium = findings.filter((f) => f.severity === "medium");
    console.log(`critical=${crit.length} high=${high.length} medium=${medium.length} ok=${findings.filter((f) => f.severity === "ok").length}`);
    for (const f of [...crit, ...high, ...medium]) {
        console.log(` - [${f.severity}] ${f.code}: ${f.msg}`);
    }

    await conn.end();
    process.exit(crit.length ? 2 : high.length ? 3 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
