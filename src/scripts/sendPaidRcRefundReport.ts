import "dotenv/config";
import { initDatabase, appDatabase } from "../utils/database.util";
import { RefundRequestService } from "../services/RefundRequestService";

type CliOptions = {
  asOf?: string;
  force: boolean;
  dryRun: boolean;
  includeGroupDm: boolean;
  recordExternalSend: boolean;
  channel?: string;
};

function readCliOptions(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    force: false,
    dryRun: false,
    includeGroupDm: false,
    recordExternalSend: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--as-of") {
      options.asOf = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--as-of=")) {
      options.asOf = arg.slice("--as-of=".length);
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--include-group-dm") {
      options.includeGroupDm = true;
    } else if (arg === "--record-external-send") {
      options.recordExternalSend = true;
    } else if (arg === "--channel") {
      options.channel = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--channel=")) {
      options.channel = arg.slice("--channel=".length);
    }
  }

  return options;
}

function parseAsOfDate(value?: string) {
  if (!value) return new Date();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --as-of value: ${value}`);
  }
  return parsed;
}

async function main() {
  const options = readCliOptions();
  await initDatabase();
  if (!appDatabase.isInitialized) {
    throw new Error("Database initialization failed.");
  }

  const result = await new RefundRequestService().sendWeeklyPaidRcRefundReport(parseAsOfDate(options.asOf), {
    force: options.force,
    dryRun: options.dryRun,
    includeGroupDm: options.includeGroupDm,
    channel: options.channel,
    recordExternalSend: options.recordExternalSend,
  });

  console.log(JSON.stringify({
    skipped: result.skipped,
    dryRun: result.dryRun,
    reportKey: result.reportKey,
    cutoff: `${result.startLabel} - ${result.endLabel}`,
    transactionCount: result.transactionCount,
    targets: result.targets,
    message: result.message,
    lines: result.lines,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (appDatabase.isInitialized) {
      await appDatabase.destroy();
    }
    const redisConnection = await import("../utils/redisConnection").catch(() => null);
    redisConnection?.default?.disconnect();
    process.exit(process.exitCode || 0);
  });
