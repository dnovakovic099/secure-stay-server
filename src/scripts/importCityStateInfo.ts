import dotenv from "dotenv";
dotenv.config();

import logger from "../utils/logger.utils";
import { appDatabase } from "../utils/database.util";
import * as fs from "fs";
import * as path from "path";

interface CityStateInfo {
  id: number;
  city: string;
  state_id: string;
  state_name: string;
  lat: string;
  lng: string;
  createdAt: string;
  updatedAt: string;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export async function importCityStateInfo() {
  logger.info("Starting city_state_info import...");

  const csvPath = path.resolve(__dirname, "../../city_state_info.csv");

  if (!fs.existsSync(csvPath)) {
    logger.error(`CSV file not found at: ${csvPath}`);
    throw new Error(`CSV file not found at: ${csvPath}`);
  }

  const fileContent = fs.readFileSync(csvPath, "utf-8");
  const lines = fileContent.split("\n").filter((line) => line.trim());

  // Skip header
  const dataLines = lines.slice(1);
  logger.info(`Found ${dataLines.length} records to import`);

  const BATCH_SIZE = 1000;
  let imported = 0;

  await appDatabase.manager.transaction(async (tx) => {
    for (let i = 0; i < dataLines.length; i += BATCH_SIZE) {
      const batch = dataLines.slice(i, i + BATCH_SIZE);
      const values: CityStateInfo[] = [];

      for (const line of batch) {
        const parts = parseCSVLine(line);
        if (parts.length >= 8) {
          values.push({
            id: parseInt(parts[0], 10),
            city: parts[1],
            state_id: parts[2],
            state_name: parts[3],
            lat: parts[4],
            lng: parts[5],
            createdAt: parts[6],
            updatedAt: parts[7],
          });
        }
      }

      if (values.length > 0) {
        // Build insert query
        const insertValues = values
          .map(
            (v) =>
              `(${v.id}, ${tx.connection.driver.escape(v.city)}, ${tx.connection.driver.escape(v.state_id)}, ${tx.connection.driver.escape(v.state_name)}, ${tx.connection.driver.escape(v.lat)}, ${tx.connection.driver.escape(v.lng)}, ${tx.connection.driver.escape(v.createdAt)}, ${tx.connection.driver.escape(v.updatedAt)})`
          )
          .join(",");

        await tx.query(`
          INSERT INTO city_state_info (id, city, state_id, state_name, lat, lng, createdAt, updatedAt)
          VALUES ${insertValues}
          ON DUPLICATE KEY UPDATE 
            city = VALUES(city),
            state_id = VALUES(state_id),
            state_name = VALUES(state_name),
            lat = VALUES(lat),
            lng = VALUES(lng)
        `);

        imported += values.length;
        logger.info(`Imported ${imported}/${dataLines.length} records`);
      }
    }
  });

  logger.info(`City state info import completed. Total records: ${imported}`);
}

// Run if called directly
if (require.main === module) {
  appDatabase
    .initialize()
    .then(() => importCityStateInfo())
    .then(() => {
      logger.info("Import completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Import failed:", error);
      process.exit(1);
    });
}
