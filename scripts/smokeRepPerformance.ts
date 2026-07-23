/**
 * Live smoke for AdminInsightsService.repPerformance.
 * Run on EC2: npx ts-node scripts/smokeRepPerformance.ts
 */
import "dotenv/config";

async function main() {
    process.env.NODE_ENV = "development";
    const { appDatabase } = await import("../src/utils/database.util");
    const { AdminInsightsService } = await import("../src/services/AdminInsightsService");
    await appDatabase.initialize();

    const cols: any[] = await appDatabase.query(
        "SHOW COLUMNS FROM ai_message_feedback LIKE 'subjectUserId'"
    );
    console.log("subjectUserId column:", cols.length ? "OK" : "MISSING");

    const svc = new AdminInsightsService();
    const end = new Date();
    const start = new Date(Date.now() - 7 * 86400000);
    const report = await svc.repPerformance({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        days: 7,
    });

    console.log(
        JSON.stringify(
            {
                since: report.since,
                until: report.until,
                timezone: report.timezone,
                missedThresholdMinutes: report.missedThresholdMinutes,
                repCount: report.reps.length,
                top: report.reps.slice(0, 8).map((r) => ({
                    name: r.name,
                    up: r.managerFeedback.thumbsUp,
                    down: r.managerFeedback.thumbsDown,
                    replies: r.replies,
                    avgRT: r.avgResponseTimeMinutes,
                    missed: r.missedMessages,
                    takeover: r.takeoverMessages,
                })),
            },
            null,
            2
        )
    );

    if (!report.reps.length) {
        console.warn("WARN: no reps returned (may be empty window / no GR employees)");
    } else {
        console.log("OK: rep performance smoke passed");
    }

    await appDatabase.destroy().catch(() => undefined);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
