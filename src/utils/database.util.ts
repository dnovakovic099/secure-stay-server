import { DataSource } from "typeorm";

export const appDatabase = new DataSource({
  type: "mariadb",
  host: process.env.DATABASE_URL,
  port: Number(process.env.DATABASE_PORT),
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  synchronize: false,
  entities: ["src/entity/*.ts"],
  subscribers: ["src/subscriber/*.ts"],
  migrations: ["src/migration/*.ts"],
});
