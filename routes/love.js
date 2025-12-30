import express from "express";
import { pool } from "../db.js";
import { calculateLoveForCpin } from "../utils/calcLove.js";
import { io } from "../server.js";
import { sendPush } from "../utils/sendPush.js";
import { getPartnerFcm } from "../utils/getPartnerFcm.js";
import { updateStreakForCpin } from "../utils/streak.js";

const router = express.Router();

/**
 * POST /love/interact
 * body: { cpin, user, event }
 * logs an interaction event (message, image, video, voice_call, video_call, poke, game_played, game_won)
 */
router.post("/interact", async (req, res) => {
  try {
    const { cpin, user, event } = req.body;
    if (!cpin || !user || !event) return res.status(400).json({ error: "Missing params" });

    await pool.query(
      `INSERT INTO interaction_events (cpin, user_phone, event_type) VALUES ($1, $2, $3)`,
      [cpin, user, event]
    );

    // update last_active_date in couple_state (create row if missing)
    await pool.query(
      `INSERT INTO couple_state (cpin, last_active_date, updated_at)
       VALUES ($1, CURRENT_DATE, now())
       ON CONFLICT (cpin) DO UPDATE SET last_active_date = CURRENT_DATE, updated_at = now()`,
      [cpin]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("interact error", err);
    res.status(500).json({ error: "server error" });
  }
});

/**
 * GET /love/state/:cpin
 * returns current couple state + a simple mock payload (quests, badges)
 */
router.get("/state/:cpin", async (req, res) => {
  try {
    const { cpin } = req.params;
    if (!cpin) return res.status(400).json({ error: "Missing cpin" });

    const st = await pool.query("SELECT * FROM couple_state WHERE cpin = $1", [cpin]);
    const state = st.rows[0] || {
      cpin,
      love_score: 0,
      streak_days: 0,
      last_streak_date: null,
      last_active_date: null,
    };

    // mock quests / badges for now - frontend uses its own mocks; but return placeholders
    const quests = await pool.query(
      `SELECT quest_id, quest_text, date FROM daily_quests WHERE cpin = $1 AND date = CURRENT_DATE`,
      [cpin]
    );

    const todayCompletedRes = await pool.query(
      `SELECT has_completed
      FROM completed_days
      WHERE cpin = $1 AND date = CURRENT_DATE`,
      [cpin]
    );

    const todayCompleted =
      todayCompletedRes.rowCount > 0 && todayCompletedRes.rows[0].has_completed;


    res.json({
      loveScore: state.love_score,
      streakDays: state.streak_days,
      lastStreakDate: state.last_streak_date,
      lastActiveDate: state.last_active_date,
      todayCompleted: todayCompleted,
      todaysQuests: quests.rows,
      badges: [],
    });
  } catch (err) {
    console.error("state error", err);
    res.status(500).json({ error: "server error" });
  }
});

function localDateString() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

/**
 * POST /love/quest/complete
 * body: { cpin, user_phone, quest_id }
 * Marks that user claims to have completed quest -> creates quest_actions (completed)
 * Then sends back a response so frontend can notify partner for approval (push handled elsewhere)
 */
router.post("/quest/complete", async (req, res) => {
  try {
    const { cpin, user_phone, quest_id } = req.body;
    if (!cpin || !user_phone || !quest_id) return res.status(400).json({ error: "Missing params" });

    const q = await pool.query(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date_str 
        FROM daily_quests WHERE quest_id = $1`,
        [quest_id]
    );

    const pgDate = q.rows[0].date_str;
    const today = localDateString();

    if (pgDate !== today) {
        return res.status(400).json({ error: "Quest not valid today" });
    }

    // record completion action
    await pool.query(
      `UPDATE quest_actions
      SET action_type = 'completed',
          action_at = NOW(),
          user_phone = $3
      WHERE quest_id = $1
        AND cpin = $2`,
      [quest_id, cpin, user_phone]
    );

    // fetch couple row
    const coupleRes = await pool.query(
      `SELECT user1, user2, user1_fcm, user2_fcm
      FROM couples WHERE cpin = $1`,
      [cpin]
    );

    const couple = coupleRes.rows[0];

    // emit socket (foreground)
    io.to(cpin).emit("quest-pending", {
      cpin,
      quest_id,
      from: user_phone,
    });

    // push notification (background / killed)
    const token = getPartnerFcm(couple, user_phone);

    await sendPush(
      token,
      "Quest pending approval ❤️",
      "Your partner completed a quest. Tap to review.",
      {
        type: "quest_pending",
        quest_id,
        cpin,
      }
    );

    // Backend should now notify partner that approval is pending (via push/socket) — frontend will call /quest/approve
    res.json({ success: true });
  } catch (err) {
    console.error("quest complete error", err);
    res.status(500).json({ error: "server error" });
  }
});

/**
 * POST /love/quest/approve
 * body: { cpin, approver_phone, quest_id, approved: true/false }
 *
 * If approved:
 *  - insert action_type=approved by approver
 *  - check whether both users have at least one approved completion today -> update completed_days and potentially modify streak
 */
router.post("/quest/approve", async (req, res) => {
  try {
    const { cpin, approver_phone, quest_id, approved } = req.body;
    if (!cpin || !approver_phone || !quest_id || typeof approved === "undefined")
      return res.status(400).json({ error: "Missing params" });

    // Prevent self approval
    const completedBy = await pool.query(
        `SELECT user_phone FROM quest_actions 
        WHERE quest_id = $1 AND action_type = 'completed'`,
    [quest_id]
    );

    if (!completedBy.rows.length) {
        return res.status(400).json({ error: "Quest not marked completed yet" });
    }

    if (completedBy.rows[0].user_phone === approver_phone) {
        return res.status(400).json({ error: "Cannot approve your own request" });
    }

    // Prevent double approval
    const alreadyApproved = await pool.query(
        `SELECT 1 FROM quest_actions
        WHERE quest_id = $1 AND action_type = 'approved'
        AND user_phone = $2`,
        [quest_id, approver_phone]
    );

    if (alreadyApproved.rowCount > 0) {
        return res.status(400).json({ error: "Already approved" });
    }

    const actionType = approved ? "approved" : "rejected";
    await pool.query(
      `UPDATE quest_actions
      SET action_type = $4,
          action_at = NOW(),
          user_phone = $3
      WHERE quest_id = $1
        AND cpin = $2`,
      [quest_id, cpin, approver_phone, actionType]
    );

    if (approved) {
      // mark completed_days if both partners have at least one APPROVED action today
      // find distinct users who have 'approved' or 'completed'->'approved' for today's quests
      const approvedUsersRes = await pool.query(
        `SELECT DISTINCT qa.user_phone
         FROM quest_actions qa
         JOIN daily_quests dq ON qa.quest_id = dq.quest_id
         WHERE dq.cpin = $1
           AND dq.date = CURRENT_DATE
           AND qa.action_type = 'approved'`,
        [cpin]
      );

      // approvedUsersRes.rows contains approver phones; but we need to ensure both partners have approved a completion:
      // Fetch the two partner phones from couple_state? Not stored — so simpler: if at least 2 distinct users approved today, treat as both completed.
      const distinctCount = approvedUsersRes.rowCount;

      if (distinctCount >= 2) {
        await pool.query(
          `INSERT INTO completed_days (cpin, date, has_completed)
          VALUES ($1, CURRENT_DATE, true)
          ON CONFLICT (cpin, date) DO UPDATE SET has_completed = true`,
          [cpin]
        );

        // 🔥 UPDATE STREAK
        try {
          await updateStreakForCpin(cpin);
        } catch (e) {
          console.error("streak update failed:", e);
        }

        // ❤️ Update love score
        try {
          await calculateLoveForCpin(cpin);
        } catch (e) {
          console.error("failed to calc love after approval:", e);
        }
      }

    }


    const coupleRes = await pool.query(
      `SELECT user1, user2, user1_fcm, user2_fcm
      FROM couples WHERE cpin = $1`,
      [cpin]
    );

    const couple = coupleRes.rows[0];

    io.to(cpin).emit("quest-updated", {
      cpin,
      quest_id,
      approved,
      by: approver_phone,
    });

    // push notification
    const token = getPartnerFcm(couple, approver_phone);

    await sendPush(
      token,
      approved ? "Quest approved 🎉" : "Quest rejected",
      approved
        ? "Your partner approved your quest!"
        : "Your partner rejected the quest.",
      {
        type: "quest_updated",
        quest_id,
        approved,
        cpin,
      }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("quest approve error", err);
    res.status(500).json({ error: "server error" });
  }
});

router.get("/quests/:cpin", async (req, res) => {
  const { cpin } = req.params;

  const quests = await pool.query(
    `SELECT dq.quest_id, dq.quest_text, dq.date, qa.action_type, qa.user_phone
     FROM quest_actions qa
     RIGHT JOIN daily_quests dq ON qa.quest_id = dq.quest_id
     WHERE dq.cpin = $1
     ORDER BY dq.quest_id ASC`,
    [cpin]
  );

  res.json(quests.rows);
});

router.post("/fcm", async (req, res) => {
  const { cpin, phone, fcmToken } = req.body;

  if (!cpin || !phone || !fcmToken)
    return res.status(400).json({ error: "Missing params" });

  const result = await pool.query(
    `
    UPDATE couples
    SET
      user1_fcm = CASE WHEN user1 = $2 THEN $3 ELSE user1_fcm END,
      user2_fcm = CASE WHEN user2 = $2 THEN $3 ELSE user2_fcm END
    WHERE cpin = $1
    `,
    [cpin, phone, fcmToken]
  );

  res.json({ success: true });
});

export default router;