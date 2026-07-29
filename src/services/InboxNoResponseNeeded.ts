import { appDatabase } from "../utils/database.util";

/**
 * Staff Hostify notes like "No response needed" (Nikki / Anj, Jul 2026) mark an
 * inquiry as deliberately closed for reply. Those threads were still landing in
 * New inquiries / Awaiting reply because notes don't flip `answered`, and a later
 * guest ping ("Looking for an update") kept them pinned.
 *
 * Once a matching note exists on the thread, it stays out of those queues and
 * the AI stops drafting — staff already said no reply is needed.
 */

const NRN_PATTERNS = [
    /no\s*response\s*needed/i,
    /no\s*reply\s*needed/i,
    /\bnrn\b/i,
];

export function isNoResponseNeededNoteText(text?: string | null): boolean {
    const t = String(text || "").trim();
    if (!t) return false;
    return NRN_PATTERNS.some((re) => re.test(t));
}

/** SQL predicate on an inbox_messages alias `nrn` matching NRN note text. */
export const NRN_NOTE_SQL = `
(
    nrn.note IS NOT NULL
    AND TRIM(nrn.note) <> ''
    AND (
        LOWER(nrn.note) LIKE '%no response needed%'
        OR LOWER(nrn.note) LIKE '%no reply needed%'
        OR LOWER(nrn.note) REGEXP '[[:<:]]nrn[[:>:]]'
    )
)
`;

/**
 * True when thread c has any NRN Hostify/SS note.
 * Expects alias `c` = inbox_conversations.
 */
export const HAS_NRN_NOTE_SQL = `
EXISTS (
    SELECT 1
    FROM inbox_messages nrn
    WHERE nrn.threadId = c.threadId
      AND ${NRN_NOTE_SQL}
)
`;

/** @deprecated alias — same as HAS_NRN_NOTE_SQL */
export const HAS_ACTIVE_NRN_SQL = HAS_NRN_NOTE_SQL;

export async function hasNoResponseNeededNote(threadId: number): Promise<boolean> {
    const rows: Array<{ hit: number }> = await appDatabase.query(
        `
        SELECT 1 AS hit
        FROM inbox_messages nrn
        WHERE nrn.threadId = ?
          AND nrn.note IS NOT NULL
          AND TRIM(nrn.note) <> ''
          AND (
              LOWER(nrn.note) LIKE '%no response needed%'
              OR LOWER(nrn.note) LIKE '%no reply needed%'
              OR LOWER(nrn.note) REGEXP '[[:<:]]nrn[[:>:]]'
          )
        LIMIT 1
        `,
        [Number(threadId)]
    );
    return Boolean(rows?.length);
}

/** @deprecated alias */
export const hasActiveNoResponseNeededNote = hasNoResponseNeededNote;
