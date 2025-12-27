import { pool } from "../db.js";

export async function updateStreakForCpin(cpin) {
  const res = await pool.query(
    `SELECT streak_days, last_streak_date
     FROM couple_state
     WHERE cpin = $1`,
    [cpin]
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let streakDays = 1;

  if (res.rowCount > 0 && res.rows[0].last_streak_date) {
    const last = new Date(res.rows[0].last_streak_date);
    last.setHours(0, 0, 0, 0);

    const diffDays = Math.round((today - last) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      // already counted today
      return;
    }

    streakDays = (res.rows[0]?.streak_days || 0) + 1;
  }

  await pool.query(
    `INSERT INTO couple_state (cpin, streak_days, last_streak_date, updated_at)
     VALUES ($1, $2, CURRENT_DATE, now())
     ON CONFLICT (cpin)
     DO UPDATE SET
       streak_days = $2,
       last_streak_date = CURRENT_DATE,
       updated_at = now()`,
    [cpin, streakDays]
  );
}