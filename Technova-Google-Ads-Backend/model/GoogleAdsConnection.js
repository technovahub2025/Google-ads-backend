const db = require("../config/firebase");

const GOOGLE_ADS_CONNECTIONS = "google_ads_connections";

const saveGoogleAdsConnection = async (data) => {
  const docRef = await db.collection(GOOGLE_ADS_CONNECTIONS).add({
    refreshToken: data.refreshToken,
    connected: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return docRef.id;
};

const getGoogleAdsConnection = async (connectionId) => {
  if (!connectionId) return null;

  const snapshot = await db
    .collection(GOOGLE_ADS_CONNECTIONS)
    .doc(connectionId)
    .get();

  if (!snapshot.exists) return null;

  return { id: snapshot.id, ...snapshot.data() };
};

const listGoogleAdsConnections = async () => {
  const snapshot = await db.collection(GOOGLE_ADS_CONNECTIONS).get();

  return snapshot.docs.map((doc) => {
    const { connected, googleAccount, createdAt, updatedAt } = doc.data();
    return {
      connectionId: doc.id,
      connected: connected === true,
      ...(googleAccount ? { googleAccount } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    };
  });
};

module.exports = {
  saveGoogleAdsConnection,
  getGoogleAdsConnection,
  listGoogleAdsConnections,
};
