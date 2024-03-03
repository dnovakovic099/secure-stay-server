import dotenv from "dotenv";
dotenv.config();
import "reflect-metadata";
import express from "express";
import { scheduleGetReservation } from "./utils/scheduler.util";
import { createRouting } from "./utils/router.util";
import { appDatabase } from "./utils/database.util";
import { errorHandler } from "./middleware/error.middleware";
import appRoutes from './router/appRoutes';
import cors from 'cors';

const main = async () => {
    const app = express();
    app.use(cors());
    app.use(express.json())
    app.listen(process.env.PORT);
    scheduleGetReservation()
    app.use(appRoutes)
    createRouting(app)
    app.use(errorHandler)
    console.log("Express application is up and running on port " + process.env.PORT);
    await appDatabase.initialize();
};

main().catch((err) => {
  console.error(err, "-------------------------");
});
