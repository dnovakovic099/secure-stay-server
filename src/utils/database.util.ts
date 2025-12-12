import { DataSource } from "typeorm";
import logger from "./logger.utils";

export const appDatabase = new DataSource({
  type: "mariadb",
  host: process.env.DATABASE_URL,
  port: Number(process.env.DATABASE_PORT),
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  synchronize: false,
  entities: [process.env.NODE_ENV === 'production' ? "dist/out-tsc/entity/*.js" : "src/entity/*.ts"],
  subscribers: [process.env.NODE_ENV === 'production' ? "dist/out-tsc/subscriber/*.js" : "src/subscriber/*.ts"],
  migrations: [process.env.NODE_ENV === 'production' ? "dist/out-tsc/migration/*.js" : "src/migration/*.ts"],
  extra: {
    connectionLimit: 20
  },
  charset: "utf8mb4",
});


export async function initDatabase() {
  if (appDatabase.isInitialized) {
    return appDatabase;
  }

  try {
    await appDatabase.initialize();
    logger.info("📌 Database connected");
  } catch (err) {
    logger.error("❌ Database initialization failed:", err);
  }

  return appDatabase;
}