import { pool } from "../db.js";
import { calculateLoveForCpin } from "./calcLove.js";

// Simple quest list – expand as needed
const QUESTS = [
  // 💬 Communication & Connection
  "Send your partner a selfie today",
  "Tell your partner one thing you love about them",
  "Ask your partner a question you've never asked before",
  "Share a voice message today",
  "Tell your partner today's highlight",
  "Send a good morning or good night message",
  "Send a heartfelt message without emojis",
  "Send a message using only emojis",
  "Send a message starting with 'I appreciate you because…'",
  "Tell your partner one thing you admire about them",

  // 🧠 Reflection & Emotions
  "Share one thing you're grateful for today",
  "Tell your partner something that made you smile today",
  "Share one thing that stressed you today",
  "Tell your partner how they've positively impacted your life",
  "Share a small worry you've been carrying",
  "Tell your partner one thing you're proud of them for",
  "Share a childhood memory",
  "Share a memory that still makes you laugh",
  "Share a memory where you felt closest to your partner",
  "Tell your partner something you're excited about",

  // 🎧 Voice, Audio & Presence
  "Send a 30-second voice note about your day",
  "Send a voice note saying your partner's name",
  "Record a short audio describing where you are right now",
  "Send a calming voice note",
  "Send a voice note saying three kind things",
  "Send a voice note pretending you're leaving a voicemail",
  "Read a short poem or quote out loud",
  "Send a voice note telling a funny story",
  "Send a voice note sharing a secret thought",
  "Send a voice note wishing them a good day or night",

  // 📸 Visual & Creative
  "Share a picture of something near you",
  "Send a picture that represents your mood",
  "Send a picture of something that reminded you of your partner",
  "Share a picture of your current view",
  "Send a picture of something colorful",
  "Send a picture of something comforting",
  "Send a throwback photo and explain it",
  "Send a picture of your workspace or study area",
  "Send a picture of something that made you smile",
  "Draw a quick doodle and send it",

  // 🎮 Fun & Play
  "Play one game together today",
  "Send a funny meme",
  "Challenge your partner to a mini game",
  "Ask your partner a 'this or that' question",
  "Play 20 questions with your partner",
  "Send a riddle and wait for the answer",
  "Share a joke and rate each other's reaction",
  "Challenge your partner to send a selfie with a funny face",
  "Make up a fake story together one message at a time",
  "Send a playful dare (keep it kind)",

  // 🎵 Media & Shared Experiences
  "Share a song that matches your mood today",
  "Share a song that reminds you of your partner",
  "Recommend a movie or show to watch together",
  "Watch the same video and discuss it",
  "Share a quote you like today",
  "Share a lyric that describes how you feel",
  "Send a link to something interesting you found",
  "Recommend a podcast episode",
  "Share a book or article you enjoyed",
  "Send a song and explain why you chose it",

  // 💞 Affection & Appreciation
  "Tell your partner one reason you're grateful for them",
  "Write a short love note",
  "Send a message starting with 'I miss you because…'",
  "Tell your partner what you're looking forward to doing together",
  "Compliment your partner in a unique way",
  "Tell your partner how they make you feel safe",
  "Send a message imagining your next meetup",
  "Tell your partner something you admire about their personality",
  "Send a message saying thank you for something specific",
  "End the day by reminding your partner they matter to you"
];

function pickRandomQuests() {
  const shuffled = [...QUESTS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

export async function generateDailyQuests() {
  try {
    const cpins = await pool.query("SELECT cpin FROM couple_state");

    for (const { cpin } of cpins.rows) {
      const yesterdayCheck = await pool.query(
        `SELECT 1 FROM completed_days
         WHERE cpin = $1
           AND date = CURRENT_DATE - INTERVAL '1 day'
           AND has_completed = true`,
        [cpin]
      );

      if (yesterdayCheck.rowCount === 0) {
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
        `DELETE FROM daily_quests WHERE cpin = $1`,
        [cpin]
      );

      for (const q of quests) {
        const quest_id = Math.floor(Math.random() * 1_000_000);

        await pool.query(
          `INSERT INTO daily_quests (quest_id, cpin, date, quest_text, created_at)
           VALUES ($1, $2, CURRENT_DATE, $3, NOW())`,
          [quest_id, cpin, q]
        );

        await pool.query(
          `INSERT INTO quest_actions
           (quest_id, cpin, user_phone, action_type, action_at)
           VALUES ($1, $2, NULL, 'pending', NOW())`,
          [quest_id, cpin]
        );
      }
    }

    console.log("✨ Daily quests generated successfully");
    process.exit(0);
  } catch (err) {
    console.error("❌ Daily quest generation failed:", err);
    process.exit(1);
  }
}

export async function dailyLoveScoreJob() {
  try {
    console.log("Running daily love score job...");

    const rows = await pool.query(`SELECT cpin FROM couple_state`);
    for (const r of rows.rows) {
      try {
        await calculateLoveForCpin(r.cpin);
      } catch (err) {
        console.error("Error calculating love for", r.cpin, err);
      }
    }

    console.log("Done daily love score job.");
  } catch (err) {
    console.error("Daily love cron error", err);
  }
}