import AgentAPI from 'apminsight';
AgentAPI.config();
import dotenv from "dotenv";
dotenv.config();
import "reflect-metadata";
import express from "express";
import { scheduleGetReservation } from "./utils/scheduler.util";
import { createRouting } from "./utils/router.util";
import { initDatabase } from "./utils/database.util";
import { errorHandler } from "./middleware/error.middleware";
import appRoutes from "./router/appRoutes";
import cors from "cors";
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

  const app = express();
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
};

main().catch((err) => {
  logger.error("Fatal startup error:", err);
});

