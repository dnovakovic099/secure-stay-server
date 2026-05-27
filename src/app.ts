// import AgentAPI from 'apminsight';
// AgentAPI.config();
import dotenv from "dotenv";
dotenv.config();
import "reflect-metadata";
import express from "express";
import qs from "qs";
import { scheduleGetReservation } from "./utils/scheduler.util";
import { createRouting } from "./utils/router.util";
import { ensureIssueMetadataColumns, initDatabase } from "./utils/database.util";
import { errorHandler } from "./middleware/error.middleware";
import appRoutes from "./router/appRoutes";
import cors from "cors";
import compression from "compression";
import logger from "./utils/logger.utils";

// 🔹 Global error handlers
process.on("uncaughtException", (err) => {
  logger.error("🔥 Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("🚨 Unhandled Promise Rejection:", reason);
});

const main = async () => {
  // STEP 1: Connect to DB BEFORE starting server
  await initDatabase();
  await ensureIssueMetadataColumns();

  const app = express();
  // Trust one layer of reverse proxy (Nginx) so req.ip reflects the real client IP
  app.set('trust proxy', 1);
  // Increase qs arrayLimit so repeated query params (e.g. 47 listingMapId values)
  // are parsed as arrays instead of plain objects (default limit is 20)
  app.set('query parser', (str: string) => qs.parse(str, { arrayLimit: 1000 }));
  app.use(compression());
  app.use(cors());

  // JSON parser with special webhook exception
  app.use((req, res, next) => {
    if (req.path.includes('/webhook/hostify_v1')) {
      return next();
    }
    express.json({ limit: "50mb" })(req, res, next);
  });

  app.use("/uploads", express.static("uploads"));
  app.use("/public", express.static("public"));
  app.use("/assets", express.static("assets"));

  // STEP 2: Routes should come AFTER DB is connected
  app.use(appRoutes);
  createRouting(app);

  // STEP 3: Error for invalid routes
  app.use("*", (req, res, next) => {
    next(new Error("Invalid route!"));
  });

  // STEP 4: Error handler
  app.use(errorHandler);

  // STEP 5: Start server ONLY after everything is ready
  app.listen(process.env.PORT, () => {
    logger.info("🚀 Server running on port " + process.env.PORT);
  });

  // STEP 6: Start cron jobs AFTER server starts
  scheduleGetReservation();

  // Memory monitoring: log RSS + heap every 2 minutes so we can see growth pattern
  const instanceId = process.env.NODE_APP_INSTANCE ?? 'standalone';
  const logMemory = () => {
    const m = process.memoryUsage();
    const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
    logger.info(
      `[MEM:${instanceId}] rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB heapTotal=${mb(m.heapTotal)}MB external=${mb(m.external)}MB`
    );
  };
  logMemory(); // log once at startup
  setInterval(logMemory, 2 * 60 * 1000); // then every 2 minutes
};

main().catch((err) => {
  logger.error("Fatal startup error:", err);
});
