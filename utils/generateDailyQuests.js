import cron from "node-cron";
import { pool } from "../db.js";

// Simple quest list – expand as needed
const QUESTS = [
  "Send your partner a selfie today",
  "Tell your partner one thing you love about them",
  "Ask your partner a question you've never asked before",
  "Share a voice message today",
  "Tell partner today's highlight",
  "Send a funny meme",
  "Recall a shared memory in one message",
  "Play one game together",
  "Send a good morning or good night message",
  "Share a picture of something near you",
];

function pickRandomQuests() {
  const shuffled = [...QUESTS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

cron.schedule("0 0 * * *", async () => {
  try {
    const cpins = await pool.query("SELECT cpin FROM couple_state");

    for (const row of cpins.rows) {
      const cpin = row.cpin;

      const yesterdayCheck = await pool.query(
        `SELECT 1 FROM completed_days
        WHERE cpin = $1
          AND date = CURRENT_DATE - INTERVAL '1 day'
          AND has_completed = true`,
        [cpin]
      );

      if (yesterdayCheck.rowCount === 0) {
        // ❌ Yesterday missed → reset streak
        await pool.query(
          `UPDATE couple_state
          SET streak_days = 0,
              last_streak_date = NULL,
              updated_at = now()
          WHERE cpin = $1`,
          [cpin]
        );
      }

      const quests = pickRandomQuests();

      await pool.query(
        `DELETE FROM daily_quests
        WHERE cpin = $1`,
        [cpin]
      );

      for (const q of quests) {
        const quest_id = Math.floor(Math.random() * 1000000);

        await pool.query(
          `INSERT INTO daily_quests (quest_id, cpin, date, quest_text, created_at)
            VALUES ($1, $2, CURRENT_DATE, $3, NOW())`,
          [quest_id, cpin, q]
        );

        await pool.query(
          `INSERT INTO quest_actions (quest_id, cpin, user_phone, action_type, action_at)
            VALUES ($1, $2, $3, 'pending', NOW())`,
          [quest_id, cpin, null]
        );

      }
    }

    console.log("✨ Daily quests generated for all couples");
  } catch (err) {
    console.error("Quest cron error:", err);
  }
});