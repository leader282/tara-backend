import express from "express";
import { pool } from "../db.js";
import { bucket } from "../firebase.js";

const router = express.Router();

// 🧩 Get profile info
router.get("/couple/:cpin/:phone", async (req, res) => {
  try {
    const { cpin, phone } = req.params;

    const result = await pool.query(
      `
      SELECT
        user_phone,
        display_name,
        status_message,
        to_char(anniversary_date, 'YYYY-MM-DD') AS anniversary_date,
        profile_pic_url
      FROM profiles
      WHERE cpin = $1
      `,
      [cpin]
    );

    if (result.rows.length === 0) {
      return res.json({ me: null, partner: null });
    }

    const me = result.rows.find(r => r.user_phone === phone);
    const partner = result.rows.find(r => r.user_phone !== phone);

    res.json({
      me: me || null,
      partner: partner || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load couple profile" });
  }
});

// 🧩 Update or create profile
router.post("/update", async (req, res) => {
  try {
    const {
      cpin,
      user_phone,
      display_name,
      status_message,
      anniversary_date,
      profile_pic_url,
    } = req.body;

    const existing = await pool.query(
      `
      SELECT profile_pic_url
      FROM profiles
      WHERE cpin = $1 AND user_phone = $2
      `,
      [cpin, user_phone]
    );

    const oldPath = existing.rows[0]?.profile_pic_url;

    // 1️⃣ Upsert current user's personal fields
    await pool.query(
      `
      INSERT INTO profiles (
        cpin, user_phone, display_name, status_message, anniversary_date, profile_pic_url, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (cpin, user_phone)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        status_message = EXCLUDED.status_message,
        profile_pic_url = EXCLUDED.profile_pic_url,
        updated_at = NOW()
      `,
      [cpin, user_phone, display_name, status_message, anniversary_date, profile_pic_url]
    );

    // 2️⃣ Sync anniversary across both partners (if provided)
    if (anniversary_date) {
      await pool.query(
        `
        UPDATE profiles
        SET anniversary_date = $2,
            updated_at = NOW()
        WHERE cpin = $1
        `,
        [cpin, anniversary_date]
      );
    }

    if (
      oldPath &&
      oldPath !== profile_pic_url
    ) {
      try {
        await bucket.file(oldPath).delete();
        console.log("Deleted old profile photo:", oldPath);
      } catch (err) {
        console.warn("Failed to delete old profile photo:", err.message);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});


router.post("/remove-photo", async (req, res) => {
  try {
    const { cpin, user_phone } = req.body;

    if (!cpin || !user_phone) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    await pool.query(
      `
      UPDATE profiles
      SET profile_pic_url = NULL,
          updated_at = NOW()
      WHERE cpin = $1
        AND user_phone = $2
      `,
      [cpin, user_phone]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove profile photo" });
  }
});

export default router;