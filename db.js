import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // e.g. postgres://user:pass@localhost:5432/tara
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});