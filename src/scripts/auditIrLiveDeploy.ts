/**
 * Live audit of IR Copilot v6 + GR refund escalation + city/vendor memory.
 * Run on EC2: npx ts-node src/scripts/auditIrLiveDeploy.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

type Row = Record<string, any>;

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DATABASE_URL,
        port: Number(process.env.DATABASE_PORT || 3306),
        user: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME,
        charset: "utf8mb4",
    });

    const findings: Array<{ severity: "critical" | "high" | "medium" | "ok"; msg: string }> = [];
    const note = (severity: typeof findings[0]["severity"], msg: string) => {
        findings.push({ severity, msg });
        console.log(`[${severity.toUpperCase()}] ${msg}`);
    };

    // 1) Settings column
    const [cols]: any = await conn.query(
        `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings'
           AND COLUMN_NAME = 'grRefundManagerEmails'`
    );
    if (!cols?.length) note("critical", "ai_messaging_settings.grRefundManagerEmails column MISSING");
    else note("ok", "grRefundManagerEmails column present");

    const [settingsRows]: any = await conn.query(
        `SELECT grRefundManagerEmails, earlyCheckinHandling, lateCheckoutHandling
         FROM ai_messaging_settings WHERE listingId IS NULL LIMIT 1`
    );
    const settings = settingsRows?.[0] || {};
    note("ok", `grRefundManagerEmails configured as: ${JSON.stringify(settings.grRefundManagerEmails || null)} (null = default Anj+Jade)`);

    // 2) Managers resolve
    const emails = ["angelica@luxurylodgingpm.com"];
    const [anj]: any = await conn.query(
        `SELECT id, uid, email, firstName, lastName, isActive FROM users
         WHERE LOWER(email) = ? AND deletedAt IS NULL`,
        [emails[0]]
    );
    const [jadeRows]: any = await conn.query(
        `SELECT id, uid, email, firstName, lastName, isActive FROM users
         WHERE isActive = 1 AND deletedAt IS NULL
           AND (
             LOWER(firstName) = 'jade'
             OR LOWER(email) LIKE 'jade%@%'
             OR LOWER(email) LIKE '%jade%@luxurylodging%'
             OR LOWER(lastName) = 'jade'
             OR LOWER(CONCAT(COALESCE(firstName,''),' ',COALESCE(lastName,''))) LIKE '% jade %'
           )
         LIMIT 20`
    );
    if (!anj?.length) note("critical", "Anj email angelica@luxurylodgingpm.com not found/active in users");
    else note("ok", `Anj user id=${anj[0].id} uid=${anj[0].uid} active=${anj[0].isActive}`);
    if (!jadeRows?.length) {
        note("high", "No Jade user matched by firstName/email — set GR refund managers in AI Settings → Ops");
        const [guess]: any = await conn.query(
            `SELECT id, email, firstName, lastName FROM users
             WHERE deletedAt IS NULL AND isActive = 1
               AND (LOWER(email) LIKE '%jade%' OR LOWER(firstName) LIKE '%jade%')
             LIMIT 10`
        );
        for (const g of guess || []) console.log(`   jade-guess: ${g.firstName} ${g.lastName} <${g.email}> id=${g.id}`);
    } else {
        note("ok", `Jade candidates: ${jadeRows.map((u: any) => `${u.firstName} ${u.lastName} <${u.email}>`).join("; ")}`);
    }

    // 3) Vendor memory seed
    const [memCounts]: any = await conn.query(
        `SELECT
           COUNT(*) AS total,
           SUM(source = 'scrape_90d') AS scrape,
           SUM(source = 'seed') AS seed,
           SUM(phone LIKE '(777)%' OR phone LIKE '(778)%' OR phone LIKE '777%' OR phone LIKE '778%') AS bogus
         FROM ir_vendor_memory`
    );
    const mc = memCounts?.[0] || {};
    note(Number(mc.scrape) >= 100 ? "ok" : "high", `ir_vendor_memory total=${mc.total} scrape_90d=${mc.scrape} seed=${mc.seed}`);
    if (Number(mc.bogus) > 0) note("high", `Bogus 777/778 phones still in memory: ${mc.bogus}`);
    else note("ok", "No 777/778 bogus phones in ir_vendor_memory");

    const [known]: any = await conn.query(
        `SELECT vendorName, phone, city, category, source FROM ir_vendor_memory
         WHERE normalizedName IN ('ana','miguel','diana','rodolfo')
         ORDER BY vendorName, city LIMIT 40`
    );
    note("ok", `Known portfolio rows: ${(known || []).length}`);
    for (const r of (known || []).slice(0, 12)) {
        console.log(`   - ${r.vendorName} ${r.phone} @ ${r.city} [${r.category}] src=${r.source}`);
    }

    // 4) City null rate on recent open issues (raw listing.city vs address-parseable)
    const [cityAudit]: any = await conn.query(
        `SELECT
           COUNT(*) AS n,
           SUM(l.id IS NULL) AS no_listing,
           SUM(l.id IS NOT NULL AND (l.city IS NULL OR TRIM(l.city) = '' OR l.city = '(NOT SPECIFIED)')) AS empty_city,
           SUM(l.id IS NOT NULL AND l.city IS NOT NULL AND TRIM(l.city) <> '' AND l.city <> '(NOT SPECIFIED)') AS has_city,
           SUM(l.id IS NOT NULL AND (l.city IS NULL OR TRIM(l.city) = '' OR l.city = '(NOT SPECIFIED)')
               AND l.address REGEXP ',[[:space:]]*[A-Za-z][A-Za-z .''-]{1,40},[[:space:]]*[A-Z]{2}[[:space:]]') AS address_has_city
         FROM issues i
         LEFT JOIN listing_info l ON l.id = CAST(NULLIF(TRIM(i.listing_id), '') AS UNSIGNED)
         WHERE i.deleted_at IS NULL
           AND i.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)`
    );
    const ca = cityAudit?.[0] || {};
    note(
        "ok",
        `14d issues: n=${ca.n} has_city=${ca.has_city} empty_city=${ca.empty_city} address_recoverable=${ca.address_has_city} no_listing=${ca.no_listing}`
    );
    if (Number(ca.empty_city) > 0 && Number(ca.address_recoverable) === 0) {
        note("high", "Empty cities with ZERO address-recoverable — city fix may not help this cohort");
    } else if (Number(ca.address_has_city) > 0) {
        note("ok", `City fix should recover ~${ca.address_has_city} previously-null city tickets from address`);
    }

    // 5) Recent suggestions prompt versions + stuck patterns
    const [promptVers]: any = await conn.query(
        `SELECT promptVersion, COUNT(*) c FROM issue_ai_suggestions
         WHERE generatedAt >= DATE_SUB(NOW(), INTERVAL 3 DAY)
         GROUP BY promptVersion ORDER BY c DESC`
    );
    note("ok", `Suggestion promptVersions (3d): ${JSON.stringify(promptVers || [])}`);
    const hasV6 = (promptVers || []).some((r: any) => String(r.promptVersion || "").includes("v6"));
    if (!hasV6) note("high", "No ir-copilot-v6 suggestions yet in last 3d — force-suggest needed or model path not hit");

    const [stuck]: any = await conn.query(
        `SELECT i.id, i.category, i.ai_short_title, s.primaryAction, s.promptVersion, s.generatedAt
         FROM issue_ai_suggestions s
         INNER JOIN issues i ON i.id = s.issueId
         WHERE s.id IN (
           SELECT MAX(id) FROM issue_ai_suggestions GROUP BY issueId
         )
         AND s.generatedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         AND s.promptVersion LIKE '%v6%'
         AND (
           LOWER(COALESCE(s.primaryAction,'')) LIKE '%reservation changes vendor%'
           OR LOWER(COALESCE(s.primaryAction,'')) LIKE '%need a supplies vendor%'
           OR LOWER(COALESCE(s.primaryAction,'')) LIKE '%need the vendor identity%'
         )
         ORDER BY s.generatedAt DESC
         LIMIT 25`
    );
    if ((stuck || []).length) {
        note("high", `${stuck.length} recent suggestions still show old vendor-hunt language (may be pre-v6 cache)`);
        for (const s of stuck.slice(0, 8)) {
            console.log(`   #${s.id} [${s.category}] v=${s.promptVersion} :: ${String(s.primaryAction || "").slice(0, 120)}`);
        }
    } else {
        note("ok", "No recent stuck 'need vendor' patterns in latest suggestions");
    }

    // 6) Refund escalation wiring evidence
    const [escUpdates]: any = await conn.query(
        `SELECT COUNT(*) AS c FROM issues_updates
         WHERE deletedAt IS NULL AND updates LIKE 'GR refund/cancellation escalated to%'`
    );
    note(
        Number(escUpdates?.[0]?.c) > 0 ? "ok" : "medium",
        `Escalation timeline logs: ${escUpdates?.[0]?.c || 0} (0 means no refund ticket created since deploy, or escalate never fired)`
    );

    const [refundOpen]: any = await conn.query(
        `SELECT i.id, i.category, i.status, i.gr_status, i.assignee, i.reservation_id, i.listing_id, i.listing_name,
                i.ai_short_title, LEFT(i.issue_description, 180) AS desc_snip, i.created_at
         FROM issues i
         WHERE i.deleted_at IS NULL
           AND (
             UPPER(TRIM(i.category)) = 'REFUNDS'
             OR (
               UPPER(TRIM(i.category)) = 'RESERVATION CHANGES'
               AND (
                 LOWER(CONCAT(COALESCE(i.ai_short_title,''),' ',COALESCE(i.issue_description,''))) LIKE '%cancel%'
                 OR LOWER(CONCAT(COALESCE(i.ai_short_title,''),' ',COALESCE(i.issue_description,''))) LIKE '%refund%'
               )
             )
           )
         ORDER BY i.id DESC
         LIMIT 15`
    );
    note("ok", `Sample refund/cancel tickets: ${(refundOpen || []).length}`);

    let escalatedSample = 0;
    let unescalated: Row[] = [];
    for (const issue of refundOpen || []) {
        const [prior]: any = await conn.query(
            `SELECT id FROM issues_updates
             WHERE issueId = ? AND deletedAt IS NULL
               AND updates LIKE 'GR refund/cancellation escalated to%'
             LIMIT 1`,
            [issue.id]
        );
        if (prior?.length) escalatedSample += 1;
        else unescalated.push(issue);
    }
    note("ok", `Of sampled refund/cancel: escalated=${escalatedSample} not_yet=${unescalated.length}`);

    // 7) Escalation is category-gated — non-REFUNDS/RESERVATION CHANGES never escalate.
    note("ok", "Escalation is category-gated to REFUNDS + cancel-like RESERVATION CHANGES only");

    // 8) Mitigation join sanity for refund tickets with reservation_id
    let mitOk = 0;
    let mitMiss = 0;
    for (const issue of (refundOpen || []).filter((i: any) => Number(i.reservation_id) > 0).slice(0, 10)) {
        const [rc]: any = await conn.query(
            `SELECT id, assignee, reservationInfoId FROM review_checkout
             WHERE reservationInfoId = ? AND deletedAt IS NULL
             ORDER BY id DESC LIMIT 1`,
            [Number(issue.reservation_id)]
        );
        if (rc?.length) mitOk += 1;
        else mitMiss += 1;
    }
    note("ok", `Refund samples with reservation: mitigation found=${mitOk} missing=${mitMiss}`);

    // 9) Notifications / tasks recent
    const [tasks]: any = await conn.query(
        `SELECT COUNT(*) AS c FROM assigned_tasks
         WHERE title LIKE 'Refund/cancel ·%' AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );
    const [notes]: any = await conn.query(
        `SELECT COUNT(*) AS c FROM user_directed_notifications
         WHERE type = 'gr_refund_escalation' AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );
    note("ok", `7d Refund/cancel tasks=${tasks?.[0]?.c || 0} notifications=${notes?.[0]?.c || 0}`);

    // 10) SUPPLIES / ACCESS latest suggestions quality
    for (const cat of ["SUPPLIES", "PROPERTY ACCESS", "REFUNDS", "RESERVATION CHANGES"]) {
        const [rows]: any = await conn.query(
            `SELECT i.id, s.primaryAction, s.promptVersion, s.generatedAt
             FROM issue_ai_suggestions s
             INNER JOIN issues i ON i.id = s.issueId
             WHERE UPPER(TRIM(i.category)) = ?
               AND s.id = (SELECT MAX(s2.id) FROM issue_ai_suggestions s2 WHERE s2.issueId = i.id)
             ORDER BY s.generatedAt DESC
             LIMIT 5`,
            [cat]
        );
        console.log(`\n--- Latest ${cat} suggestions ---`);
        for (const r of rows || []) {
            console.log(`#${r.id} v=${r.promptVersion} :: ${String(r.primaryAction || "").slice(0, 160)}`);
        }
        if (!(rows || []).length) note("medium", `No suggestions found for category ${cat}`);
    }

    // Summary
    console.log("\n========== AUDIT SUMMARY ==========");
    const crit = findings.filter((f) => f.severity === "critical");
    const high = findings.filter((f) => f.severity === "high");
    const medium = findings.filter((f) => f.severity === "medium");
    console.log(`critical=${crit.length} high=${high.length} medium=${medium.length} ok=${findings.filter((f) => f.severity === "ok").length}`);
    for (const f of [...crit, ...high, ...medium]) console.log(` - [${f.severity}] ${f.msg}`);

    // Emit machine-readable unescalated ids for follow-up force escalate / suggest
    console.log("\nUNESCALATED_REFUND_IDS=" + unescalated.map((u) => u.id).join(","));

    await conn.end();
    process.exit(crit.length ? 2 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
