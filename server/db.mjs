import "dotenv/config";
import pg from "pg";

// Single connection pool shared by all queries. Credentials come from .env
// only; nothing is hardcoded here.
export const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
});

export async function shutdown() {
  await pool.end();
}
