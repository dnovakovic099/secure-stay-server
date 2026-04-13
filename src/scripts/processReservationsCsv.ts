import dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import csvParser from "csv-parser";
import logger from "../utils/logger.utils";
import { appDatabase } from "../utils/database.util";
import { listingIdMappings } from "../constant";

const INPUT_FILE = path.resolve(__dirname, "../../../2025-complete-reservations-all.csv");
const OUTPUT_FILE = path.resolve(__dirname, "../../../2025-complete-reservations-all-processed.csv");

// Build a quick lookup: hostaway_id -> hostify_id
const hostawayToHostify = new Map<number, number>(
  listingIdMappings.map(({ hostaway_id, hostify_id }) => [hostaway_id, hostify_id])
);

function calculateNights(checkIn: string, checkOut: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / msPerDay);
}

function escapeField(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function fetchListingNames(hostifyIds: Set<number>): Promise<Map<number, string>> {
  if (hostifyIds.size === 0) return new Map();

  const placeholders = Array.from(hostifyIds)
    .map(() => "?")
    .join(",");
  const rows: { id: number; internalListingName: string }[] = await appDatabase.query(
    `SELECT id, internalListingName FROM listing_info WHERE id IN (${placeholders})`,
    Array.from(hostifyIds)
  );

  logger.info(`Found ${rows.length}/${hostifyIds.size} listings in DB`);
  return new Map(rows.map((r) => [Number(r.id), r.internalListingName]));
}

function readCsv(filePath: string): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    const headers: string[] = [];
    const rows: Record<string, string>[] = [];
    let headersCapured = false;

    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on("headers", (h: string[]) => {
        headers.push(...h);
        headersCapured = true;
      })
      .on("data", (row: Record<string, string>) => rows.push(row))
      .on("end", () => resolve({ headers, rows }))
      .on("error", reject);

    // csv-parser fires "headers" before "data", but guard just in case
    void headersCapured;
  });
}

export async function processReservationsCsv(): Promise<void> {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file not found: ${INPUT_FILE}`);
  }

  logger.info(`Reading ${path.basename(INPUT_FILE)}...`);
  const { headers, rows } = await readCsv(INPUT_FILE);
  logger.info(`Read ${rows.length} rows`);

  // Collect all hostify IDs needed for a single bulk DB query
  const hostifyIds = new Set<number>();
  for (const row of rows) {
    const rawId = row["ListingMap ID"]?.trim();
    if (!rawId) continue;
    const hostawayId = parseInt(rawId, 10);
    if (isNaN(hostawayId)) continue;
    const hostifyId = hostawayToHostify.get(hostawayId);
    if (hostifyId !== undefined) hostifyIds.add(hostifyId);
  }

  const listingNames = await fetchListingNames(hostifyIds);

  // Filter and transform rows
  const outputRows: Record<string, string>[] = [];
  let skippedNoMapping = 0;
  let skippedOffboarded = 0;

  for (const row of rows) {
    const rawId = row["ListingMap ID"]?.trim();
    if (!rawId) {
      skippedNoMapping++;
      continue;
    }

    const hostawayId = parseInt(rawId, 10);
    if (isNaN(hostawayId) || !hostawayToHostify.has(hostawayId)) {
      skippedNoMapping++;
      continue;
    }

    const hostifyId = hostawayToHostify.get(hostawayId)!;
    if (!listingNames.has(hostifyId)) {
      skippedOffboarded++;
      continue;
    }

    // Replace listing name
    row["Listing"] = listingNames.get(hostifyId)!;

    // Recalculate nights (stored under new column name)
    const checkIn = row["Check-in date"]?.trim();
    const checkOut = row["Check-out date"]?.trim();
    if (checkIn && checkOut) {
      const nights = calculateNights(checkIn, checkOut);
      if (!isNaN(nights)) row["Nights"] = String(nights);
    }

    // Prepend '$ ' to total price
    const price = row["Total price"]?.trim();
    if (price && !price.startsWith("$")) {
      row["Total price"] = `$ ${price}`;
    }

    outputRows.push(row);
  }

  // Rename columns in the output
  const COLUMN_RENAMES: Record<string, string> = {
    "ListingMap ID": "Listing parent ID",
    "Number of nights": "Nights",
  };
  const outputHeaders = headers.map((h) => COLUMN_RENAMES[h] ?? h);

  // Write output CSV
  const headerLine = outputHeaders.map(escapeField).join(",");
  const dataLines = outputRows.map((row) =>
    outputHeaders.map((h) => escapeField(row[h] ?? "")).join(",")
  );
  fs.writeFileSync(OUTPUT_FILE, [headerLine, ...dataLines].join("\n"), "utf-8");

  logger.info(`
Done:
  Input rows   : ${rows.length}
  Output rows  : ${outputRows.length}
  No mapping   : ${skippedNoMapping}
  Offboarded   : ${skippedOffboarded}
  Output file  : ${path.basename(OUTPUT_FILE)}
  `);
}

if (require.main === module) {
  appDatabase
    .initialize()
    .then(() => processReservationsCsv())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error("Script failed:", err);
      process.exit(1);
    });
}
