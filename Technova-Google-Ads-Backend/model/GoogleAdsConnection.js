const db = require("../config/firebase");

const GOOGLE_ADS_CONNECTIONS = "google_ads_connections";

const saveGoogleAdsConnection = async (data) => {
  const docRef = await db.collection(GOOGLE_ADS_CONNECTIONS).add({
    refreshToken: data.refreshToken,
    nexionUserId: data.nexionUserId || null,
    companyId: data.companyId || null,
    googleAccount: data.googleAccount || null,
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
    const { connected, googleAccount, createdAt, updatedAt, nexionUserId, companyId } = doc.data();
    return {
      connectionId: doc.id,
      connected: connected === true,
      ...(googleAccount ? { googleAccount } : {}),
      ...(nexionUserId ? { nexionUserId } : {}),
      ...(companyId ? { companyId } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    };
  });
};

const saveOAuthState = async (state, identity, expiresAt) => db.collection("google_ads_oauth_states").doc(state).set({
  nexionUserId: identity.userId, companyId: identity.companyId || null, expiresAt, createdAt: new Date(),
});
const consumeOAuthState = async (state) => {
  const ref = db.collection("google_ads_oauth_states").doc(state);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return null;
    tx.delete(ref);
    const data = doc.data();
    return data.expiresAt?.toDate?.() > new Date() ? data : null;
  });
};
const assignCustomerAccount = async ({ userId, companyId, connectionId, customerId }) => {
  const id = String(userId);
  await db.collection("google_ads_customer_assignments").doc(id).set({ userId, companyId: companyId || null, connectionId, customerId: String(customerId), updatedAt: new Date() });
};
const getCustomerAssignment = async (userId) => {
  const snap = await db.collection("google_ads_customer_assignments").where("userId", "==", String(userId)).limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
};
const listCustomerAssignments = async () => {
  const snap = await db.collection("google_ads_customer_assignments").get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};
module.exports = {
  saveGoogleAdsConnection,
  getGoogleAdsConnection,
  listGoogleAdsConnections,
  saveOAuthState,
  consumeOAuthState,
  assignCustomerAccount,
  getCustomerAssignment,
  listCustomerAssignments,
};
