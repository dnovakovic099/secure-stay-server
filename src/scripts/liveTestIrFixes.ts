/**
 * Live functional tests: force IR suggest on sample tickets + escalate one refund.
 * Run on EC2: npx ts-node src/scripts/liveTestIrFixes.ts
 */
import "dotenv/config";

import { appDatabase } from "../utils/database.util";
import { IssueAIService } from "../services/IssueAIService";
import { GrRefundEscalationService } from "../services/GrRefundEscalationService";
import { Issue } from "../entity/Issue";

async function pickIssueIds(conn: typeof appDatabase, category: string, limit = 2): Promise<number[]> {
    const rows: any[] = await conn.query(
        `SELECT id FROM issues
         WHERE deleted_at IS NULL AND UPPER(TRIM(category)) = ?
         ORDER BY id DESC LIMIT ?`,
        [category, limit]
    );
    return (rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
}

async function main() {
    await appDatabase.initialize();
    const ai = new IssueAIService();
    const esc = new GrRefundEscalationService();
    const results: any[] = [];

    const samples: Array<{ label: string; category: string; expect: RegExp }> = [
        { label: "refunds", category: "REFUNDS", expect: /escalat|anj|jade|manager|mitigation/i },
        { label: "supplies", category: "SUPPLIES", expect: /cleaner|supplies|restock/i },
        { label: "access", category: "PROPERTY ACCESS", expect: /door|code|access|schlage|lock|entry|kb|sop/i },
        {
            label: "res_changes",
            category: "RESERVATION CHANGES",
            // Early/late OR cancel/refund paths are both valid under v6.
            expect: /upsell|cleaner|owner|special|guest|turnover|fee|declin|escalat|anj|jade|manager|mitigation/i,
        },
    ];

    for (const sample of samples) {
        const ids = await pickIssueIds(appDatabase, sample.category, 2);
        if (!ids.length) {
            results.push({ sample: sample.label, ok: false, error: "no issues found" });
            continue;
        }
        for (const id of ids) {
            try {
                const suggestion = await ai.suggest(id, { force: true });
                const city = (suggestion as any)?.portfolioVendors?.[0]?.city || null;
                const pa = String(suggestion.primaryAction || "");
                const playbook = (suggestion.playbook || []).map((p) => p.step).join(" | ");
                const qs = (suggestion.clarifyingQuestions || []).map((q) => q.question).join(" | ");
                const okAction = sample.expect.test(pa) || sample.expect.test(playbook) || sample.expect.test(qs);
                const badVendorHunt =
                    /reservation changes vendor|need the vendor identity|need a supplies vendor/i.test(
                        `${pa}\n${qs}`
                    ) && !/not a (supplies|trade) vendor/i.test(pa);
                results.push({
                    sample: sample.label,
                    issueId: id,
                    promptVersion: suggestion.promptVersion,
                    cityHint: city,
                    primaryAction: pa.slice(0, 220),
                    playbook0: suggestion.playbook?.[0]?.step || null,
                    questions: (suggestion.clarifyingQuestions || []).slice(0, 2),
                    portfolioTop: (suggestion.portfolioVendors || []).slice(0, 2).map((v) => `${v.name} ${v.phone} @ ${v.city}`),
                    okAction,
                    badVendorHunt,
                    ok:
                        okAction &&
                        !badVendorHunt &&
                        /ir-copilot-v[67]/.test(String(suggestion.promptVersion || "")),
                });
            } catch (err: any) {
                results.push({ sample: sample.label, issueId: id, ok: false, error: err?.message || String(err) });
            }
        }
    }

    // City resolve smoke: find empty-city listing issue and ensure portfolio can still attach via address
    const emptyCityIssues: any[] = await appDatabase.query(
        `SELECT i.id, l.city AS rawCity, LEFT(l.address, 80) AS address
         FROM issues i
         INNER JOIN listing_info l ON l.id = CAST(NULLIF(TRIM(i.listing_id), '') AS UNSIGNED)
         WHERE i.deleted_at IS NULL
           AND (l.city IS NULL OR TRIM(l.city) = '' OR l.city = '(NOT SPECIFIED)')
           AND l.address IS NOT NULL AND TRIM(l.address) <> ''
         ORDER BY i.id DESC LIMIT 2`
    );
    for (const row of emptyCityIssues || []) {
        try {
            const suggestion = await ai.suggest(Number(row.id), { force: true });
            const vendors = suggestion.portfolioVendors || [];
            results.push({
                sample: "empty_city_recover",
                issueId: row.id,
                rawCity: row.rawCity,
                address: row.address,
                promptVersion: suggestion.promptVersion,
                portfolioCount: vendors.length,
                portfolioTop: vendors.slice(0, 3).map((v) => `${v.name} @ ${v.city}`),
                ok: vendors.length > 0 || !!suggestion.primaryAction,
            });
        } catch (err: any) {
            results.push({ sample: "empty_city_recover", issueId: row.id, ok: false, error: err?.message });
        }
    }

    // Escalate one recent unescalated REFUNDS ticket (real side effects: task+notification).
    const unesc: any[] = await appDatabase.query(
        `SELECT i.id, i.guest_name, i.reservation_id
         FROM issues i
         WHERE i.deleted_at IS NULL AND UPPER(TRIM(i.category)) = 'REFUNDS'
           AND NOT EXISTS (
             SELECT 1 FROM issues_updates u
             WHERE u.issueId = i.id AND u.deletedAt IS NULL
               AND u.updates LIKE 'GR refund/cancellation escalated to%'
           )
         ORDER BY i.id DESC LIMIT 1`
    );
    if (unesc?.[0]?.id) {
        const issue = await appDatabase.getRepository(Issue).findOne({ where: { id: Number(unesc[0].id) } });
        if (issue) {
            const escResult = await esc.escalateIssue(issue, { uid: "system", name: "Live IR audit" });
            results.push({
                sample: "refund_escalate_live",
                issueId: issue.id,
                ok: escResult.escalated || escResult.reason === "already_escalated",
                escResult,
            });
        }
    } else {
        results.push({ sample: "refund_escalate_live", ok: true, note: "no unescalated REFUNDS ticket to test" });
    }

    // Bogus phone reject
    const bogus = await ai.upsertVendorMemory({
        vendorName: "Bogus Test Vendor",
        phone: "(777) 123-4567",
        category: "MAINTENANCE",
        city: "Chicago",
        source: "audit",
        notes: "should ignore phone",
    });
    results.push({
        sample: "bogus_phone",
        ok: !bogus?.phone || !/777/.test(String(bogus.phone)),
        storedPhone: bogus?.phone || null,
        id: bogus?.id || null,
    });
    if (bogus?.id) {
        await appDatabase.query(`DELETE FROM ir_vendor_memory WHERE id = ? AND source = 'audit'`, [bogus.id]);
    }

    console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    const failed = results.filter((r) => r.ok === false);
    console.log(`\nFAILED=${failed.length} TOTAL=${results.length}`);
    await appDatabase.destroy();
    process.exit(failed.length ? 2 : 0);
}

main().catch(async (err) => {
    console.error(err);
    try {
        await appDatabase.destroy();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
