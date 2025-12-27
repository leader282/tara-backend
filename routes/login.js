import express from "express";
import { pool } from "../db.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { phone, cpin } = req.body;

  if (!phone || !cpin) {
    return res.status(400).json({ error: "Phone and CPIN are required" });
  }

  try {
    // 1️⃣ Find CPIN in couples table
    const result = await pool.query("SELECT * FROM couples WHERE cpin = $1", [cpin]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Invalid CPIN or Mobile number" });
    }

    const couple = result.rows[0];

    // 2️⃣ Case A: phone matches existing user1 or user2
    if (couple.user1 === phone || couple.user2 === phone) {

      await pool.query(
        `
        INSERT INTO couple_state (cpin, last_active_date, updated_at)
        VALUES ($1, CURRENT_DATE, now())
        ON CONFLICT (cpin)
        DO UPDATE SET
          last_active_date = CURRENT_DATE,
          updated_at = now()
        `,
        [cpin]
      );

      return res.json({
        status: "ok",
        message: "Login successful",
        partner: couple.user1 === phone ? couple.user2 : couple.user1,
      });
    }

    // 3️⃣ Case B: user2 is empty, allow pairing
    if (!couple.user2) {

      await pool.query(
        `
        INSERT INTO couple_state (cpin, last_active_date, updated_at)
        VALUES ($1, CURRENT_DATE, now())
        ON CONFLICT (cpin)
        DO UPDATE SET
          last_active_date = CURRENT_DATE,
          updated_at = now()
        `,
        [cpin]
      );

      await pool.query("UPDATE couples SET user2 = $1 WHERE cpin = $2", [phone, cpin]);
      return res.json({
        status: "ok",
        message: "Paired successfully",
        partner: couple.user1,
      });
    }

    // 4️⃣ Case C: already paired and new number trying to join
    return res.status(403).json({ error: "Invalid CPIN or Mobile number" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;