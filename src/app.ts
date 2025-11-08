import dotenv from "dotenv";
dotenv.config();
import "reflect-metadata";
import express from "express";
import { scheduleGetReservation } from "./utils/scheduler.util";
import { createRouting } from "./utils/router.util";
import { appDatabase } from "./utils/database.util";
import { errorHandler } from "./middleware/error.middleware";
import appRoutes from "./router/appRoutes";
import cors from "cors";
import logger from "./utils/logger.utils";

// 🔹 Handle uncaught exceptions at the very top
process.on("uncaughtException", (err) => {
  logger.error("🔥 Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("🚨 Unhandled Promise Rejection:", reason);
});

const main = async () => {
  const app = express();
  app.use(cors());

  // JSON parser middleware that skips the hostify webhook route (needs raw text body for SNS)
  app.use((req, res, next) => {
    // Skip JSON parsing for hostify webhook - it needs raw text body
    if (req.path.includes('/webhook/hostify_v1')) {
      return next();
    }
    express.json({ limit: "50mb" })(req, res, next);
  });
  // app.use(express.json());
  app.use("/uploads", express.static("uploads"));
  app.use("/public", express.static("public"));
  app.use("/assets",express.static("assets"));

  app.listen(process.env.PORT);
  scheduleGetReservation();
  app.use(appRoutes);

  createRouting(app);

  app.use("*", (req, res, next) => {
    console.log("error occure");

    next(new Error("invalid Route!"));
  });

  app.use(errorHandler);
  console.log(
    "Express application is up and running on port " + process.env.PORT
  );
  await appDatabase.initialize();
};

main().catch((err) => {
  console.error(err, "-------------------------");
});
