// utils/calcLove.js
import { pool } from "../db.js";

/**
 * Calculate love score for a cpin and update couple_state.
 * The weights and caps follow the design we agreed on.
 */
export async function calculateLoveForCpin(cpin) {
  // Messages
  const msgRes = await pool.query(
    `SELECT COUNT(*) FROM messages WHERE cpin = $1 AND message IS NOT NULL AND message <> ''`,
    [cpin]
  );
  const messages = Number(msgRes.rows[0].count);

  // Media
  const mediaRes = await pool.query(
    `SELECT COUNT(*) FROM gallery WHERE cpin=$1`,
    [cpin]
  );
  const media = Number(mediaRes.rows[0].count);

  // Completed days
  const completedRes = await pool.query(
    `SELECT COUNT(*) FROM completed_days
     WHERE cpin=$1 AND has_completed=true`,
    [cpin]
  );
  const completedDays = Number(completedRes.rows[0].count);

  // Streak
  const stateRes = await pool.query(
    `SELECT streak_days, last_active_date
     FROM couple_state WHERE cpin=$1`,
    [cpin]
  );
  const streak = Number(stateRes.rows[0]?.streak_days || 0);
  const lastActive = stateRes.rows[0]?.last_active_date;

  // Games
  const gamesRes = await pool.query(
    `SELECT COUNT(*) FROM interaction_events
     WHERE cpin=$1 AND event_type='game_played'`,
    [cpin]
  );
  const games = Number(gamesRes.rows[0].count);

  // Inactivity penalty
  let inactivityPenalty = 0;

  console.log("Last active:", lastActive);

  if (lastActive) {
    const diffRes = await pool.query(
      `SELECT CURRENT_DATE - $1::date AS diff`,
      [lastActive]
    );
    const daysInactive = Number(diffRes.rows[0].diff);

    console.log("Days inactive:", daysInactive);

    inactivityPenalty = Math.max(0, daysInactive - 3);
  }

  const loveScore =
    3 * Math.log1p(messages) +
    6 * Math.log1p(media) +
    8 * Math.sqrt(completedDays) +
    5 * Math.sqrt(streak) +
    4 * Math.log1p(games) -
    2 * inactivityPenalty;

  console.log(messages, media, completedDays, streak, games, inactivityPenalty);
  console.log(loveScore);

  const finalScore = Math.max(0, Math.round(loveScore));

  await pool.query(
    `UPDATE couple_state
     SET love_score=$2, updated_at=now()
     WHERE cpin=$1`,
    [cpin, finalScore]
  );

  return finalScore;
}