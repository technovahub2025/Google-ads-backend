const db = require("../config/firebase");

const GOOGLE_ADS_CONNECTIONS = "google_ads_connections";

const saveGoogleAdsConnection = async (data) => {
  const docRef = db.collection(GOOGLE_ADS_CONNECTIONS).doc(data.nexionUserId);

  await docRef.set(
    {
      nexionUserId: data.nexionUserId,
      refreshToken: data.refreshToken,
      connected: true,
      updatedAt: new Date(),
    },
    { merge: true }
  );

  return docRef.id;
};

const getGoogleAdsConnection = async (nexionUserId) => {
  const docRef = db
    .collection(GOOGLE_ADS_CONNECTIONS)
    .doc(nexionUserId);

  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data();
};

module.exports = {
  saveGoogleAdsConnection,
  getGoogleAdsConnection,
};
