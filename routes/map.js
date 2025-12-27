import express from "express";
import { pool } from "../db.js";

const router = express.Router();

// 🧭 Update location for a user
router.post("/update", async (req, res) => {
  try {
    const { cpin, phone, lat, lon } = req.body;

    if (!cpin || !phone || lat == null || lon == null)
      return res.status(400).json({ error: "Missing parameters" });

    // check existing entry
    const existing = await pool.query("SELECT * FROM locations WHERE cpin = $1", [cpin]);

    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO locations (cpin, user1_phone, user1_lat, user1_lon, user1_updated)
         VALUES ($1, $2, $3, $4, NOW())`,
        [cpin, phone, lat, lon]
      );
    } else {
      const row = existing.rows[0];
      if (row.user1_phone === phone) {
        await pool.query(
          `UPDATE locations SET user1_lat=$1, user1_lon=$2, user1_updated=NOW() WHERE cpin=$3`,
          [lat, lon, cpin]
        );
      } else if (row.user2_phone === phone || row.user2_phone == null) {
        await pool.query(
          `UPDATE locations SET user2_phone=$1, user2_lat=$2, user2_lon=$3, user2_updated=NOW() WHERE cpin=$4`,
          [phone, lat, lon, cpin]
        );
      } else {
        return res.status(400).json({ error: "Both users already set for this CPIN" });
      }
    }

    console.log(`📍 Location updated for CPIN ${cpin}, Phone ${phone}`);

    res.json({ success: true });
  } catch (err) {
    console.error("Location update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// 🧭 Get both users' locations for a CPIN
router.get("/:cpin", async (req, res) => {
  try {
    const { cpin } = req.params;
    const result = await pool.query("SELECT * FROM locations WHERE cpin=$1", [cpin]);
    if (result.rows.length === 0) return res.status(404).json({ error: "No data" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Get location error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;