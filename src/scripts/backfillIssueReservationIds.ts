import "dotenv/config";
import { appDatabase, initDatabase } from "../utils/database.util";

type RepairSource = {
  reservationId: number;
  reason: string;
};

type IssueRepairCandidate = {
  issueId: number;
  currentReservationId: string | null;
  targetReservationId: number;
  reason: string;
};

type IssueTableColumns = {
  aiSourceRef?: string;
  source?: string;
};

type ScriptOptions = {
  apply: boolean;
  issueIds: number[];
  limit?: number;
};

const parseOptions = (): ScriptOptions => {
  const options: ScriptOptions = { apply: false, issueIds: [] };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") options.apply = true;
    if (arg.startsWith("--issueId=")) {
      options.issueIds = arg
        .slice("--issueId=".length)
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0);
    }
    if (arg.startsWith("--limit=")) {
      const limit = Number(arg.slice("--limit=".length));
      if (Number.isFinite(limit) && limit > 0) options.limit = limit;
    }
  }
  return options;
};

const normalizeReservationId = (value: any) => {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "NA" || raw === "0") return null;
  const numberValue = Number(raw);
  return Number.isFinite(numberValue) && numberValue > 0 ? String(numberValue) : null;
};

const uniqueByReservation = (sources: RepairSource[]) => {
  const byReservation = new Map<number, string[]>();
  for (const source of sources) {
    if (!Number.isFinite(source.reservationId) || source.reservationId <= 0) continue;
    byReservation.set(source.reservationId, [
      ...(byReservation.get(source.reservationId) || []),
      source.reason,
    ]);
  }
  return byReservation;
};

const getIssueTableColumns = async (): Promise<IssueTableColumns> => {
  const rows: Array<{ Field: string }> = await appDatabase.query(`SHOW COLUMNS FROM issues`);
  const columns = new Set(rows.map((row) => row.Field));
  return {
    aiSourceRef: columns.has("aiSourceRef")
      ? "aiSourceRef"
      : columns.has("ai_source_ref")
        ? "ai_source_ref"
        : undefined,
    source: columns.has("source") ? "source" : undefined,
  };
};

const getThreadReservation = async (threadId: number, reason: string): Promise<RepairSource | null> => {
  const rows: Array<{ reservationId: number | null }> = await appDatabase.query(
    `SELECT reservationId FROM inbox_conversations WHERE threadId = ? LIMIT 1`,
    [threadId]
  );
  const reservationId = Number(rows[0]?.reservationId);
  return Number.isFinite(reservationId) && reservationId > 0
    ? { reservationId, reason }
    : null;
};

const resolveIssueReservation = async (issue: any): Promise<{ targetReservationId: number; reason: string } | null> => {
  const sources: RepairSource[] = [];
  const aiSourceRef = String(issue.aiSourceRef || issue.ai_source_ref || "").trim();
  const detectedId = aiSourceRef.startsWith("ai_detected_items:")
    ? Number(aiSourceRef.split(":")[1])
    : null;

  if (detectedId && Number.isFinite(detectedId)) {
    const detectedRows: Array<{ threadId: number | null; reservationId: number | null }> = await appDatabase.query(
      `SELECT threadId, reservationId FROM ai_detected_items WHERE id = ? LIMIT 1`,
      [detectedId]
    );
    const detected = detectedRows[0];
    const threadId = Number(detected?.threadId);
    if (Number.isFinite(threadId) && threadId > 0) {
      const threadSource = await getThreadReservation(threadId, `aiSourceRef detected item ${detectedId} thread ${threadId}`);
      if (threadSource) sources.push(threadSource);
    }
    const detectedReservationId = Number(detected?.reservationId);
    if (Number.isFinite(detectedReservationId) && detectedReservationId > 0) {
      sources.push({
        reservationId: detectedReservationId,
        reason: `aiSourceRef detected item ${detectedId} reservation`,
      });
    }
  }

  const ownerNotes = String(issue.owner_notes || "");
  const noteThreadId = Number(ownerNotes.match(/Inbox V2 thread ID:\s*(\d+)/i)?.[1]);
  if (Number.isFinite(noteThreadId) && noteThreadId > 0) {
    const threadSource = await getThreadReservation(noteThreadId, `owner_notes Inbox V2 thread ${noteThreadId}`);
    if (threadSource) sources.push(threadSource);
  }

  const noteMessageId = Number(ownerNotes.match(/Created from Inbox V2 message\s+(\d+)/i)?.[1]);
  if (Number.isFinite(noteMessageId) && noteMessageId > 0) {
    const messageRows: Array<{ threadId: number | null }> = await appDatabase.query(
      `SELECT threadId FROM inbox_messages WHERE externalId = ? LIMIT 1`,
      [noteMessageId]
    );
    const messageThreadId = Number(messageRows[0]?.threadId);
    if (Number.isFinite(messageThreadId) && messageThreadId > 0) {
      const threadSource = await getThreadReservation(
        messageThreadId,
        `owner_notes Inbox V2 message ${noteMessageId} thread ${messageThreadId}`
      );
      if (threadSource) sources.push(threadSource);
    }
  }

  const byReservation = uniqueByReservation(sources);
  if (byReservation.size !== 1) return null;
  const [targetReservationId, reasons] = Array.from(byReservation.entries())[0];

  const reservationRows: Array<{ id: number }> = await appDatabase.query(
    `SELECT id FROM reservation_info WHERE id = ? LIMIT 1`,
    [targetReservationId]
  );
  if (!reservationRows.length) return null;

  return {
    targetReservationId,
    reason: reasons.join("; "),
  };
};

async function main() {
  const options = parseOptions();
  await initDatabase();
  if (!appDatabase.isInitialized) {
    throw new Error("Database connection was not initialized. Check DATABASE_URL, DATABASE_PORT, DATABASE_USERNAME, DATABASE_PASSWORD, and DATABASE_NAME.");
  }

  const params: any[] = [];
  const issueColumns = await getIssueTableColumns();
  const selectColumns = [
    "id",
    "reservation_id",
    "owner_notes",
    "creator",
    issueColumns.aiSourceRef ? `${issueColumns.aiSourceRef} AS aiSourceRef` : "NULL AS aiSourceRef",
    issueColumns.source ? `${issueColumns.source} AS source` : "NULL AS source",
  ];
  const sourcePredicates = [
    `owner_notes REGEXP 'Inbox V2 thread ID|Created from Inbox V2 message'`,
    `creator = 'AI Assistant'`,
  ];
  if (issueColumns.aiSourceRef) sourcePredicates.unshift(`${issueColumns.aiSourceRef} LIKE 'ai_detected_items:%'`);
  if (issueColumns.source) sourcePredicates.push(`${issueColumns.source} IN ('ai_inbox', 'ai_beta')`);
  const whereParts = [
    `deleted_at IS NULL`,
    `(${sourcePredicates.join(" OR ")})`,
  ];

  if (options.issueIds.length) {
    whereParts.push(`id IN (?)`);
    params.push(options.issueIds);
  }

  const limitClause = options.limit ? ` LIMIT ${Number(options.limit)}` : "";
  const issues: any[] = await appDatabase.query(
    `SELECT ${selectColumns.join(", ")}
       FROM issues
      WHERE ${whereParts.join(" AND ")}
      ORDER BY id ASC${limitClause}`,
    params
  );

  const repairs: IssueRepairCandidate[] = [];
  const skipped = {
    unresolved: 0,
    alreadyCorrect: 0,
  };

  for (const issue of issues) {
    const resolved = await resolveIssueReservation(issue);
    if (!resolved) {
      skipped.unresolved += 1;
      continue;
    }

    const currentReservationId = normalizeReservationId(issue.reservation_id);
    if (currentReservationId === String(resolved.targetReservationId)) {
      skipped.alreadyCorrect += 1;
      continue;
    }

    repairs.push({
      issueId: Number(issue.id),
      currentReservationId,
      targetReservationId: resolved.targetReservationId,
      reason: resolved.reason,
    });
  }

  console.log(JSON.stringify({
    mode: options.apply ? "apply" : "dry-run",
    scanned: issues.length,
    repairCount: repairs.length,
    skipped,
    repairs,
  }, null, 2));

  if (!options.apply || repairs.length === 0) return;

  for (const repair of repairs) {
    await appDatabase.query(
      `UPDATE issues
          SET reservation_id = ?, updated_by = COALESCE(updated_by, 'system:reservation-backfill')
        WHERE id = ?`,
      [String(repair.targetReservationId), repair.issueId]
    );
  }

  console.log(`Updated ${repairs.length} issue reservation id${repairs.length === 1 ? "" : "s"}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (appDatabase.isInitialized) {
      await appDatabase.destroy().catch(() => undefined);
    }
  });
