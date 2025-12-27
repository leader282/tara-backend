import express from "express";
import { pool } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { bucket } from "../firebase.js";

const router = express.Router();

// 🧩 1. Generate upload URL
router.post("/upload-request", async (req, res) => {
  const { cpin, uploader, fileName } = req.body;
  if (!cpin || !uploader || !fileName) return res.status(400).json({ error: "Missing fields" });

  const uniqueName = `${cpin}/${uuidv4()}-${fileName}`;
  const file = bucket.file(uniqueName);

  // Signed URL valid for 10 minutes
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + 10 * 60 * 1000,
    contentType: "application/octet-stream",
  });

  console.log(`Generated upload URL for CPIN: ${cpin}, by: ${uploader}`);

  res.json({ uploadUrl: url, storagePath: uniqueName });
});

// 🧩 2. Confirm upload
router.post("/confirm", async (req, res) => {

  const {
    cpin,
    uploader,
    storagePath,
    type,
    visibilityType, // 'permanent' | 'timed' | 'one_time'
    durationSeconds, // only for timed
    profile         // optional, boolean
  } = req.body;

  if (!cpin || !uploader || !storagePath || !type || !visibilityType) {
    console.error("Missing fields in upload confirmation:", req.body);
    return res.status(400).json({ error: "Missing fields" });
  }

  let expiresAt = null;
  let maxViews = null;

  if (visibilityType === "timed") {
    expiresAt = new Date(Date.now() + durationSeconds * 1000);
  }

  if (visibilityType === "one_time") {
    maxViews = 1;
  }

  const file = bucket.file(storagePath);

  // Get a public download URL (includes token)
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: "03-01-2030", // long-lived URL for simplicity
  });

  if (profile) {
    console.log(`Setting profile picture for CPIN: ${cpin}, user: ${uploader}`);
    
    return res.status(200).json({ message: "Upload confirmed" });
  }

  try {
    await pool.query(
      `
      INSERT INTO gallery (
        cpin, uploader, storage_path,
        visibility_type, expires_at, max_views, storage_object
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        cpin,
        uploader,
        url,
        visibilityType,
        expiresAt,
        maxViews,
        storagePath
      ]
    );
  } catch (error) {
    console.error("DB Insert Error:", error);
    return res.status(500).json({ error: "Database error" });
  }

  console.log(`Upload confirmed for CPIN: ${cpin}, by: ${uploader}`);

  return res.status(200).json({ message: "Upload confirmed" });
});

// 🧩 3. Get gallery list
router.get("/:cpin", async (req, res) => {
  const { cpin } = req.params;

  const query = `
    SELECT g.*,
      (
        SELECT COUNT(*) FROM gallery_views v
        WHERE v.gallery_id = g.id
      ) AS view_count
    FROM gallery g
    WHERE g.cpin = $1
      AND (
        g.expires_at IS NULL OR g.expires_at > NOW()
      )
    ORDER BY g.uploaded_at DESC
  `;

  try {
    const result = await pool.query(query, [cpin]);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching gallery:", err);
    res.status(500).json({ error: "Database error" });
  }
});

router.post("/view", async (req, res) => {
  const { galleryId, viewer } = req.body;

  const gRes = await pool.query(
    `SELECT * FROM gallery WHERE id = $1`,
    [galleryId]
  );

  if (gRes.rowCount === 0) {
    return res.status(404).json({ error: "Media not found" });
  }

  const media = gRes.rows[0];

  // uploader can always view
  if (media.uploader === viewer) {
    return res.json({ allowed: true, uploaderView: true });
  }

  // timed expiry check
  if (
    media.visibility_type === "timed" &&
    media.expires_at &&
    new Date(media.expires_at) < new Date()
  ) {
    return res.status(403).json({ error: "Expired" });
  }

  // partner: check if already viewed
  const viewed = await pool.query(
    `SELECT 1 FROM gallery_views
     WHERE gallery_id = $1 AND viewer_phone = $2`,
    [galleryId, viewer]
  );

  if (viewed.rowCount > 0) {
    return res.status(403).json({ error: "Already viewed" });
  }

  // register view (authorization)
  await pool.query(
    `INSERT INTO gallery_views (gallery_id, viewer_phone)
     VALUES ($1, $2)`,
    [galleryId, viewer]
  );

  res.json({ allowed: true });
});

router.post("/consume", async (req, res) => {
  const { galleryId, viewer } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const gRes = await client.query(
      `
      SELECT uploader, storage_object, visibility_type
      FROM gallery
      WHERE id = $1
      FOR UPDATE
      `,
      [galleryId]
    );

    if (gRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.json({ success: true, deleted: false }); // already gone
    }

    const media = gRes.rows[0];

    // uploader never triggers deletion
    if (media.uploader === viewer) {
      await client.query("COMMIT");
      return res.json({ success: true, deleted: false });
    }

    // delete only for ephemeral types
    if (
      media.visibility_type === "one_time" ||
      media.visibility_type === "timed"
    ) {
      await client.query(`DELETE FROM gallery WHERE id = $1`, [galleryId]);

      try {
        await bucket.file(media.storage_object).delete();
      } catch (e) {
        console.error("Firebase delete failed:", e);
      }
    }

    await client.query("COMMIT");
    res.json({ success: true, deleted: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Consume error:", e);
    res.status(500).json({ error: "Consume failed" });
  } finally {
    client.release();
  }
});

export default router;