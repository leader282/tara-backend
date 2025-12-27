import express from "express";
import { pool } from "../db.js";

const router = express.Router();

router.get("/:cpin", async (req, res) => {
  const { cpin } = req.params;
  try {
    const result = await pool.query(
      "SELECT sender, message, to_char(time_sent, 'FMHH12:MI AM') AS time FROM messages WHERE cpin = $1 ORDER BY id ASC",
      [cpin]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch messages error:", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

export default router;