import express from "express";
import { pool } from "../db.js";

const router = express.Router();

// Helper: Generate random 7-char lowercase alphanumeric CPIN
function generateCPIN() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 7 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

router.post("/", async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: "Phone number required" });
  }

  try {
    // 1️⃣ Check if user already exists
    const existing = await pool.query(
      "SELECT cpin FROM couples WHERE user1 = $1 OR user2 = $1 LIMIT 1",
      [phone]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ cpin: existing.rows[0].cpin, message: "Existing user" });
    }

    // 2️⃣ Generate a unique CPIN
    let cpin;
    let unique = false;
    while (!unique) {
      cpin = generateCPIN();
      const check = await pool.query("SELECT 1 FROM couples WHERE cpin = $1", [cpin]);
      if (check.rows.length === 0) unique = true;
    }

    // 3️⃣ Insert user1 into couples table
    await pool.query(
      "INSERT INTO couples (cpin, user1) VALUES ($1, $2)",
      [cpin, phone]
    );

    return res.status(200).json({ cpin, message: "New user registered" });
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;