import admin from "firebase-admin";
import fs from "fs";

const serviceAccount = JSON.parse(
  fs.readFileSync(new URL("./tara-storage-key.json", import.meta.url), "utf8")
);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: "tara-5c982.firebasestorage.app",
    });
}

const bucket = admin.storage().bucket();

export { admin, bucket };