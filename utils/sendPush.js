import { admin } from "../firebase.js";

const fcm = admin.messaging();

export async function sendPush(token, title, body, data = {}) {
  if (!token) return;

  try {
    await fcm.send({
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: { priority: "high" },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    });
  } catch (err) {
    console.error("FCM send error:", err.message);
  }
}
