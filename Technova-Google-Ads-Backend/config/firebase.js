const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "..", "firebase-service-account.json"),
        "utf8",
      ),
    );

const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore(firebaseApp);

console.log("Firebase Firestore connected successfully");

module.exports = db;
