import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import { pool } from "./db.js";
import registerRoute from "./routes/register.js";
import loginRoute from "./routes/login.js";
import messageRoute from "./routes/messages.js";
import galleryRoute from "./routes/gallery.js";
import profileRoute from "./routes/profile.js";
import loveRoute from "./routes/love.js";
import mapRoutes from "./routes/map.js";
import { bucket } from "./firebase.js";
import cron from "node-cron";
import { calculateLoveForCpin } from "./utils/calcLove.js";
import "./utils/generateDailyQuests.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
export const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// Routes
app.use("/register", registerRoute);
app.use("/login", loginRoute);
app.use("/messages", messageRoute);
app.use("/gallery", galleryRoute);
app.use("/profile", profileRoute);
app.use("/map", mapRoutes);
app.use("/love", loveRoute);

app.get("/", (req, res) => res.send("Tara backend is alive 💖"));

app.get("/test-bucket", async (req, res) => {
  const [files] = await bucket.getFiles({ maxResults: 1 });
  res.json({ status: "ok", firstFile: files[0]?.name || "none" });
});


// --- 🔥 Socket.IO Chat Logic ---
io.on("connection", (socket) => {
  console.log("🟢 New socket connected:", socket.id);

  // Join a specific channel (CPIN acts as chat room)
  socket.on("join-room", (cpin) => {
    socket.join(cpin);
    console.log("User joined CPIN room:", [...socket.rooms]);
  });

  // 🛰️ Real-time location updates
  socket.on("location-update", async (data) => {
    const { cpin, phone, lat, lon } = data;
    if (!cpin || !phone || lat == null || lon == null) return;

    try {
      // Update database (same logic as REST)
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
        }
      }

      // Broadcast to other partner
      io.to(cpin).emit("partner-location", { phone, lat, lon, timestamp: Date.now() });
    } catch (err) {
      console.error("Realtime location update error:", err);
    }
  });

  // 💬 Typing indicator
  socket.on("typing", ({ cpin, sender }) => {
    if (!cpin || !sender) return;

    // Send ONLY to partner
    socket.to(cpin).emit("typing", {
      sender,
    });
  });

  socket.on("stop-typing", ({ cpin, sender }) => {
    if (!cpin || !sender) return;

    socket.to(cpin).emit("stop-typing", {
      sender,
    });
  });

  // Receive and broadcast message
  socket.on("send-message", async (data) => {
    const { cpin, sender, message, time } = data;
    if (!cpin || !sender || !message) return;

    // Save in DB
    await pool.query(
    "INSERT INTO messages (cpin, sender, message) VALUES ($1, $2, $3)",
    [cpin, sender, message]
    );


    // Broadcast to other user in same CPIN room
    socket.to(cpin).emit("receive-message", data);

    socket.to(cpin).emit("stop-typing", {
      sender,
    });
  });

  socket.on("disconnect", () => {
    console.log("🔴 Socket disconnected:", socket.id);
  });
});

// schedule at 00:01 every day
cron.schedule("0 0 * * *", async () => {
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Tara backend running on port ${PORT}`));