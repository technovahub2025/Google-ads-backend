const db = require("../config/firebase");
const crypto = require("crypto");

const GOOGLE_ADS_CONNECTIONS = "google_ads_connections";
const GOOGLE_ADS_CLIENTS = "google_ads_clients";
const GOOGLE_ADS_OAUTH_COMPLETIONS = "google_ads_oauth_completions";
const isRevokedAssignment = (assignment) => {
  if (String(assignment?.status || "").toLowerCase() === "revoked") return true;
  const revokedAt = assignment?.revokedAt?.toDate?.() || assignment?.revokedAt;
  return revokedAt !== undefined && revokedAt !== null && !Number.isNaN(new Date(revokedAt).getTime());
};
const normalizeOptionalManagerCustomerId = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = String(value).replace(/-/g, "");
  if (!/^\d{10}$/.test(normalized)) {
    throw Object.assign(new Error("Manager customer ID must contain exactly 10 digits"), { code: "INVALID_MANAGER_CUSTOMER_ID", status: 400 });
  }
  return normalized;
};

const createGoogleAdsClient = async ({ name, email, nexionUserId, companyId }) => {
  const clientCollection = db.collection(GOOGLE_ADS_CLIENTS);
  const existing = await clientCollection.get();
  const currentMaximum = existing.docs.reduce((max, doc) => {
    const match = /^CLT-(\d+)$/.exec(String(doc.data().clientId || doc.id));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const counterRef = db.collection("google_ads_counters").doc("client_id");
  if (nexionUserId) {
    const normalizedUserId = String(nexionUserId);
    return db.runTransaction(async (tx) => {
      const currentByNexionId = await tx.get(clientCollection.where("nexionUserId", "==", normalizedUserId).limit(1));
      const currentByLegacyId = currentByNexionId.empty
        ? await tx.get(clientCollection.where("userId", "==", normalizedUserId).limit(1))
        : currentByNexionId;
      const matched = currentByNexionId.docs?.[0] || currentByLegacyId.docs?.[0];
      if (matched) {
        const data = matched.data();
        return { client: { ...data, clientId: data.clientId || matched.id }, created: false };
      }

      const counter = await tx.get(counterRef);
      const nextValue = Math.max(Number(counter.data()?.value || 0), currentMaximum) + 1;
      const clientId = `CLT-${String(nextValue).padStart(6, "0")}`;
      const client = {
        clientId,
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
        nexionUserId: normalizedUserId,
        companyId: String(companyId),
        connectionId: null,
        customerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      tx.set(counterRef, { value: nextValue, updatedAt: new Date() });
      tx.create(clientCollection.doc(clientId), client);
      return { client, created: true };
    });
  }
  const clientId = await db.runTransaction(async (tx) => {
    const counter = await tx.get(counterRef);
    const nextValue = Math.max(Number(counter.data()?.value || 0), currentMaximum) + 1;
    tx.set(counterRef, { value: nextValue, updatedAt: new Date() });
    return `CLT-${String(nextValue).padStart(6, "0")}`;
  });
  const client = {
    clientId,
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    connectionId: null,
    customerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await clientCollection.doc(clientId).create(client);
  return client;
};

const listGoogleAdsClients = async () => {
  const collection = db.collection(GOOGLE_ADS_CLIENTS);
  const snapshot = await collection.get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return { ...data, clientId: data.clientId || doc.id };
  });
};

const getGoogleAdsClient = async (clientId) => {
  const ref = db.collection(GOOGLE_ADS_CLIENTS).doc(String(clientId));
  const snapshot = await ref.get();
  if (snapshot.exists) return { ref, client: { clientId: snapshot.data().clientId || snapshot.id, ...snapshot.data() } };
  const matches = await db.collection(GOOGLE_ADS_CLIENTS).where("clientId", "==", String(clientId)).limit(1).get();
  if (matches.empty) return null;
  return { ref: matches.docs[0].ref, client: { clientId: matches.docs[0].data().clientId || matches.docs[0].id, ...matches.docs[0].data() } };
};

const updateGoogleAdsClient = async ({ clientId, name, email }) => {
  const entry = await getGoogleAdsClient(clientId);
  if (!entry) return null;
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(entry.ref);
    if (!snapshot.exists) return null;
    const changes = { name: name.trim(), email: email.trim().toLowerCase(), updatedAt: new Date() };
    tx.update(entry.ref, changes);
    return { ...snapshot.data(), clientId: String(clientId), ...changes };
  });
};

const assignGoogleAdsAccountToClient = async ({ clientId, nexionUserId, companyId, connectionId, customerId }) => {
  if (!nexionUserId || !companyId) throw Object.assign(new Error("A verified NEXION user and company are required"), { status: 400 });
  const entry = await getGoogleAdsClient(clientId);
  if (!entry) return null;
  return db.runTransaction(async (tx) => {
    const current = await tx.get(entry.ref);
    const connectionRef = db.collection(GOOGLE_ADS_CONNECTIONS).doc(connectionId);
    const connection = await tx.get(connectionRef);
    if (!connection.exists || !connection.data().connected) throw Object.assign(new Error("Connection is unavailable"), { status: 409 });
    const client = current.data();
    const normalizedCompanyId = String(companyId);
    await assertClientConnectionAvailable(tx, client, connectionId, connection.data(), { expectedNexionUserId: nexionUserId });
    const assignmentRef = db.collection("google_ads_customer_assignments").doc(String(nexionUserId));
    const targetAssignment = await tx.get(assignmentRef);
    if (targetAssignment.exists && targetAssignment.data().clientId && String(targetAssignment.data().clientId) !== String(clientId)) {
      throw Object.assign(new Error("This NEXION user already has a different Google Ads client assignment"), { status: 409 });
    }
    const oldUserId = client.nexionUserId || client.userId || null;
    const oldAssignmentRef = oldUserId ? db.collection("google_ads_customer_assignments").doc(String(oldUserId)) : null;
    if (oldAssignmentRef && String(oldUserId) !== String(nexionUserId)) {
      const oldAssignment = await tx.get(oldAssignmentRef);
      if (oldAssignment.exists && String(oldAssignment.data().clientId || "") === String(clientId)) tx.delete(oldAssignmentRef);
    }
    if (client.connectionId && String(client.connectionId) !== String(connectionId)) {
      const oldConnectionRef = db.collection(GOOGLE_ADS_CONNECTIONS).doc(String(client.connectionId));
      const oldConnection = await tx.get(oldConnectionRef);
      if (oldConnection.exists && String(oldConnection.data().clientId || "") === String(clientId)) {
        tx.update(oldConnectionRef, { clientId: null, nexionUserId: null, companyId: null, updatedAt: new Date() });
      }
    }
    const now = new Date();
    const changes = { connectionId, customerId: String(customerId), nexionUserId: String(nexionUserId), companyId: normalizedCompanyId, connectionStatus: "connected", updatedAt: now };
    const connectionChanges = { updatedAt: now };
    // A connection already linked to a Google Ads client profile is exclusive to that profile.
    // A plain Super Admin connection remains tenant-neutral; each user assignment scopes it.
    if (connection.data().clientId) Object.assign(connectionChanges, { nexionUserId: String(nexionUserId), companyId: normalizedCompanyId });
    tx.update(connectionRef, connectionChanges);
    tx.update(entry.ref, changes);
    tx.set(assignmentRef, { userId: String(nexionUserId), companyId: normalizedCompanyId, clientId: String(clientId), connectionId, customerId: String(customerId), updatedAt: now });
    return { ...client, ...changes };
  });
};

const revokeGoogleAdsClientAssignment = async ({ clientId, nexionUserId }) => {
  const entry = await getGoogleAdsClient(clientId);
  if (!entry) return null;
  return db.runTransaction(async (tx) => {
    const current = await tx.get(entry.ref);
    if (!current.exists) return null;
    const client = current.data();
    const userId = String(nexionUserId || client.nexionUserId || client.userId || "");
    if (!userId) return { ...client, assignmentRevoked: false };
    const assignmentRef = db.collection("google_ads_customer_assignments").doc(userId);
    const assignment = await tx.get(assignmentRef);
    if (assignment.exists && String(assignment.data().clientId || "") === String(clientId)) tx.delete(assignmentRef);
    const connectionId = client.connectionId;
    if (connectionId) {
      const connectionRef = db.collection(GOOGLE_ADS_CONNECTIONS).doc(connectionId);
      const connection = await tx.get(connectionRef);
      if (connection.exists && connection.data().clientId && String(connection.data().clientId) === String(clientId) && String(connection.data().nexionUserId || "") === userId) {
        tx.update(connectionRef, { clientId: null, nexionUserId: null, companyId: null, updatedAt: new Date() });
      }
    }
    const changes = { connectionId: null, customerId: null, nexionUserId: null, companyId: null, connectionStatus: "disconnected", updatedAt: new Date() };
    tx.update(entry.ref, changes);
    return { ...client, ...changes, assignmentRevoked: assignment.exists };
  });
};

const getClientUserAssignmentRef = async (tx, client, expectedConnectionId) => {
  const userId = client.nexionUserId || client.userId;
  if (!userId) return null;
  const collection = db.collection("google_ads_customer_assignments");
  const ref = collection.doc(String(userId));
  const existing = await tx.get(ref);
  const matchingUserAssignments = await tx.get(collection.where("userId", "==", String(userId)));
  const candidates = [
    ...(existing.exists ? [{ ref, data: existing.data() }] : []),
    ...(matchingUserAssignments.docs || [])
      .filter((doc) => doc.id !== ref.id)
      .map((doc) => ({ ref: doc.ref || doc, data: doc.data() })),
  ];
  const active = candidates.filter(({ data }) => !isRevokedAssignment(data));
  const expected = expectedConnectionId || null;
  if (active.some(({ data }) => (data.clientId && String(data.clientId) !== String(client.clientId)) ||
      (data.connectionId || null) !== expected)) {
    throw Object.assign(new Error("NEXION user already has a different client connection"), { status: 409 });
  }
  const matchingActive = active.find(({ data }) => String(data.clientId || "") === String(client.clientId) &&
    (data.connectionId || null) === expected);
  if (matchingActive) return matchingActive.ref;
  if (existing.exists && isRevokedAssignment(existing.data())) return collection.doc();
  return ref;
};

// Check both explicit ownership and legacy relationships; never infer ownership from names.
const assertClientConnectionAvailable = async (tx, client, connectionId, connection, { expectedNexionUserId, reauthorizing = false } = {}) => {
  const owners = await tx.get(db.collection(GOOGLE_ADS_CLIENTS).where("connectionId", "==", connectionId));
  const assignments = await tx.get(db.collection("google_ads_customer_assignments").where("connectionId", "==", connectionId));
  const userId = client.nexionUserId || client.userId || expectedNexionUserId || null;
  if ((connection.clientId && connection.clientId !== client.clientId) ||
      ((connection.clientId || reauthorizing) && owners.docs.some((doc) => (doc.data().clientId || doc.id) !== client.clientId)) ||
      ((connection.clientId || reauthorizing) && assignments.docs.some((doc) => {
        const assignment = doc.data();
        return assignment.clientId
          ? String(assignment.clientId) !== String(client.clientId)
          : String(assignment.userId || doc.id) !== String(userId || "");
      })) ||
      (connection.clientId && userId && connection.nexionUserId && String(connection.nexionUserId) !== String(userId)) ||
      (client.companyId && connection.companyId && String(client.companyId) !== String(connection.companyId))) {
    throw Object.assign(new Error("This connection belongs to another client or NEXION account"), { status: 409 });
  }
};

const saveClientGoogleAdsConnection = async ({ identity, refreshToken, customerIds, accessToken, accessTokenExpiresAt, managerCustomerId, googleAdsAccounts }) => {
  const entry = await getGoogleAdsClient(identity.clientId);
  if (!entry) throw Object.assign(new Error("Google Ads client not found"), { status: 404 });
  const connectionRef = identity.expectedConnectionId ? db.collection(GOOGLE_ADS_CONNECTIONS).doc(identity.expectedConnectionId) : db.collection(GOOGLE_ADS_CONNECTIONS).doc();
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(entry.ref);
    const client = snapshot.data();
    if ((client.connectionId || null) !== (identity.expectedConnectionId || null) ||
        (client.nexionUserId || client.userId || null) !== (identity.nexionUserId || null) ||
        (client.companyId || null) !== (identity.companyId || null)) {
      throw Object.assign(new Error("Client connection changed. Request a new invitation."), { status: 409 });
    }
    const existingConnection = await tx.get(connectionRef);
    if (identity.expectedConnectionId) {
      if (!existingConnection.exists) throw Object.assign(new Error("Assigned connection no longer exists"), { status: 409 });
      await assertClientConnectionAvailable(tx, client, connectionRef.id, existingConnection.data(), { reauthorizing: true });
    }
    // Reauthorization replaces credentials, never the client's chosen Ads account.
    const customerId = client.customerId ? String(client.customerId) : customerIds.length === 1 ? customerIds[0] : null;
    const userAssignmentRef = await getClientUserAssignmentRef(tx, client, identity.expectedConnectionId);
    const now = new Date();
    const credentials = { clientId: identity.clientId,
      nexionUserId: identity.nexionUserId || existingConnection.data()?.nexionUserId || null,
      companyId: identity.companyId || existingConnection.data()?.companyId || null,
      refreshToken, accessToken: accessToken || null, accessTokenExpiresAt: accessTokenExpiresAt || null,
      credentialVersion: (existingConnection.data()?.credentialVersion || 0) + 1,
      connected: true, connectionStatus: "connected", updatedAt: now };
    const resolvedManagerCustomerId = normalizeOptionalManagerCustomerId(managerCustomerId ?? existingConnection.data()?.managerCustomerId);
    if (resolvedManagerCustomerId) credentials.managerCustomerId = resolvedManagerCustomerId;
    if (existingConnection.exists) tx.update(connectionRef, credentials);
    else tx.create(connectionRef, { ...credentials, googleAccount: null, googleAdsAccounts: googleAdsAccounts || [], createdAt: now });
    tx.update(entry.ref, { connectionId: connectionRef.id, customerId,
      connectionStatus: customerId ? "connected" : "account_selection_required", updatedAt: now });
    if (!identity.expectedConnectionId && userAssignmentRef && customerId) tx.set(userAssignmentRef, { userId: String(client.nexionUserId || client.userId), companyId: client.companyId || null,
      clientId: client.clientId, connectionId: connectionRef.id, customerId, updatedAt: now });
    else if (!identity.expectedConnectionId && userAssignmentRef) tx.delete(userAssignmentRef);
    return { connectionId: connectionRef.id, customerId };
  });
};

const saveGoogleAdsConnection = async (data) => {
  const managerCustomerId = normalizeOptionalManagerCustomerId(data.managerCustomerId);
  const customerId = data.customerId ? String(data.customerId) : null;
  const docRef = await db.collection(GOOGLE_ADS_CONNECTIONS).add({
    refreshToken: data.refreshToken,
    accessToken: data.accessToken || null,
    accessTokenExpiresAt: data.accessTokenExpiresAt || null,
    credentialVersion: 1,
    connectionStatus: "connected",
    nexionUserId: data.nexionUserId || null,
    companyId: data.companyId || null,
    googleAccount: data.googleAccount || null,
    ...(managerCustomerId ? { managerCustomerId } : {}),
    ...(customerId ? { customerId } : {}),
    ...(Array.isArray(data.googleAdsAccounts) ? { googleAdsAccounts: data.googleAdsAccounts } : {}),
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

const getCompanySharedGoogleAdsConnection = async (companyId) => {
  if (!companyId) return null;
  const snapshot = await db.collection(GOOGLE_ADS_CONNECTIONS)
    .where("companyId", "==", String(companyId))
    .get();
  const candidates = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((connection) => connection.connected === true && !connection.clientId)
    .sort((left, right) => (right.updatedAt?.toMillis?.() || new Date(right.updatedAt || 0).getTime()) - (left.updatedAt?.toMillis?.() || new Date(left.updatedAt || 0).getTime()));
  return candidates[0] || null;
};

// A refresh that started before reauthorization must not overwrite newer credentials.
const updateGoogleAdsCredentials = async (connectionId, expected, changes) => {
  const ref = db.collection(GOOGLE_ADS_CONNECTIONS).doc(connectionId);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    const current = snapshot.data();
    if (current.refreshToken !== expected.refreshToken || (current.credentialVersion || 0) !== (expected.credentialVersion || 0)) return false;
    const clients = await tx.get(db.collection(GOOGLE_ADS_CLIENTS).where("connectionId", "==", connectionId));
    tx.update(ref, { ...changes, updatedAt: new Date() });
    for (const client of clients.docs) {
      tx.update(client.ref, { connectionStatus: changes.connectionStatus === "reconnect_required" ? "reconnect_required" : client.data().customerId ? "connected" : "account_selection_required", updatedAt: new Date() });
    }
    return true;
  });
};

const listGoogleAdsConnections = async () => {
  const snapshot = await db.collection(GOOGLE_ADS_CONNECTIONS).get();

  return snapshot.docs.map((doc) => {
    const { connected, connectionStatus, googleAccount, createdAt, updatedAt, nexionUserId, companyId, clientId } = doc.data();
    return {
      connectionId: doc.id,
      connected: connected === true,
      connectionStatus: connectionStatus || (connected ? "connected" : "disconnected"),
      ...(clientId ? { clientId } : {}),
      ...(googleAccount ? { googleAccount } : {}),
      ...(nexionUserId ? { nexionUserId } : {}),
      ...(companyId ? { companyId } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    };
  });
};

const listGoogleAdsConnectionsForUser = async (userId) => {
  const snapshot = await db.collection(GOOGLE_ADS_CONNECTIONS).where("nexionUserId", "==", String(userId)).get();
  return snapshot.docs.map((doc) => {
    const { connected, connectionStatus, googleAccount, createdAt, updatedAt } = doc.data();
    return { connectionId: doc.id, connected: connected === true, connectionStatus: connectionStatus || (connected ? "connected" : "disconnected"), ...(googleAccount ? { googleAccount } : {}), ...(createdAt ? { createdAt } : {}), ...(updatedAt ? { updatedAt } : {}) };
  });
};

const saveOAuthState = async (state, identity, expiresAt) => db.collection("google_ads_oauth_states").doc(state).set({
  nexionUserId: identity.nexionUserId || identity.userId || null,
  companyId: identity.companyId || null,
  ...(identity.clientId ? { clientId: String(identity.clientId) } : {}),
  ...(identity.clientId ? { expectedConnectionId: identity.expectedConnectionId || null } : {}),
  ...(normalizeOptionalManagerCustomerId(identity.managerCustomerId)
    ? { managerCustomerId: normalizeOptionalManagerCustomerId(identity.managerCustomerId) }
    : {}),
  expiresAt,
  createdAt: new Date(),
});
const getOAuthState = async (state) => {
  const snapshot = await db.collection("google_ads_oauth_states").doc(state).get();
  if (!snapshot.exists || (snapshot.data().expiresAt?.toDate?.() || snapshot.data().expiresAt) <= new Date() ||
      (snapshot.data().processingExpiresAt?.toDate?.() || snapshot.data().processingExpiresAt) > new Date()) return null;
  return snapshot.data();
};
const getPendingClientOAuthState = async (clientId) => {
  const entry = await getGoogleAdsClient(clientId);
  if (!entry) return null;
  const snapshot = await db.collection("google_ads_oauth_states").where("clientId", "==", String(clientId)).get();
  const pending = snapshot.docs.find((doc) => {
    const state = doc.data();
    return state.expiresAt?.toDate?.() > new Date() &&
      !(state.processingExpiresAt?.toDate?.() > new Date()) &&
      (state.expectedConnectionId || null) === (entry.client.connectionId || null) &&
      (state.nexionUserId || null) === (entry.client.nexionUserId || entry.client.userId || null) &&
      (state.companyId || null) === (entry.client.companyId || null);
  });
  return pending ? pending.id : null;
};
const deleteOAuthState = async (state) => db.collection("google_ads_oauth_states").doc(state).delete();
const consumeOAuthState = async (state, attemptId = crypto.randomUUID()) => {
  const ref = db.collection("google_ads_oauth_states").doc(state);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return null;
    const data = doc.data();
    const now = new Date();
    const expiresAt = data.expiresAt?.toDate?.() || data.expiresAt;
    const processingExpiresAt = data.processingExpiresAt?.toDate?.() || data.processingExpiresAt;
    if (!(expiresAt > now) || processingExpiresAt > now) return null;
    tx.update(ref, { processingAttemptId: attemptId, processingExpiresAt: new Date(now.getTime() + 5 * 60 * 1000) });
    return data;
  });
};
const releaseOAuthState = async (state, attemptId) => {
  const ref = db.collection("google_ads_oauth_states").doc(state);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists || doc.data().processingAttemptId !== attemptId) return false;
    tx.update(ref, { processingAttemptId: null, processingExpiresAt: null });
    return true;
  });
};
const completeOAuthState = async (state, attemptId) => {
  const ref = db.collection("google_ads_oauth_states").doc(state);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists || doc.data().processingAttemptId !== attemptId) return false;
    tx.delete(ref);
    return true;
  });
};
const hashOAuthCompletion = (credential) => crypto.createHash("sha256").update(String(credential)).digest("hex");
const createOAuthCompletion = async (identity, expiresAt) => {
  const credential = crypto.randomBytes(32).toString("base64url");
  await db.collection(GOOGLE_ADS_OAUTH_COMPLETIONS).doc(hashOAuthCompletion(credential)).set({
    clientId: String(identity.clientId),
    connectionId: String(identity.connectionId),
    ...(identity.customerId ? { customerId: String(identity.customerId) } : {}),
    expiresAt,
    createdAt: new Date(),
  });
  return credential;
};
const consumeOAuthCompletion = async (credential) => {
  if (typeof credential !== "string" || !/^[A-Za-z0-9_-]{40,}$/.test(credential)) return null;
  const ref = db.collection(GOOGLE_ADS_OAUTH_COMPLETIONS).doc(hashOAuthCompletion(credential));
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    const expiresAt = data.expiresAt?.toDate?.() || data.expiresAt;
    if (!(expiresAt > new Date())) {
      tx.delete(ref);
      return null;
    }
    tx.delete(ref);
    return data;
  });
};
const assignCustomerAccount = async ({ userId, connectionId, customerId, assignedBy, companyId }) => {
  if (!userId || !connectionId || !customerId) throw Object.assign(new Error("userId, connectionId, and customerId are required"), { status: 400 });
  const id = String(userId);
  await db.runTransaction(async (tx) => {
    const connection = await assertUserConnectionAvailable(tx, userId, connectionId, companyId, assignedBy);
    const assignmentRef = db.collection("google_ads_customer_assignments").doc(id);
    const existing = await tx.get(assignmentRef);
    tx.set(assignmentRef, {
      ...(existing.exists ? existing.data() : {}),
      userId: id,
      companyId: companyId ? String(companyId) : null,
      connectionId: String(connectionId),
      customerId: String(customerId),
      status: "active",
      ...(assignedBy ? { assignedBy: String(assignedBy) } : {}),
      ...(existing.exists && existing.data().createdAt ? {} : { createdAt: new Date() }),
      updatedAt: new Date(),
      revokedAt: null,
      revokedBy: null,
    });
    // Older Super Admin connections may not have had their NEXION owner recorded.
    // Bind such a legacy connection to the authenticated assigning Super Admin.
    if (!connection.nexionUserId && assignedBy) {
      tx.update(db.collection(GOOGLE_ADS_CONNECTIONS).doc(String(connectionId)), {
        nexionUserId: String(assignedBy),
        updatedAt: new Date(),
      });
    }
  });
};
const revokeCustomerAssignment = async ({ userId, revokedBy }) => {
  if (!userId) throw Object.assign(new Error("userId is required"), { status: 400 });
  const collection = db.collection("google_ads_customer_assignments");
  return db.runTransaction(async (tx) => {
    const directRef = collection.doc(String(userId));
    const direct = await tx.get(directRef);
    const matches = await tx.get(collection.where("userId", "==", String(userId)));
    const candidates = [
      ...(direct.exists ? [{ ref: directRef, data: direct.data() }] : []),
      ...(matches.docs || [])
        .filter((doc) => doc.id !== directRef.id)
        .map((doc) => ({ ref: doc.ref || doc, data: doc.data() })),
    ];
    const current = candidates.find(({ data }) => String(data.status || "active").toLowerCase() !== "revoked" && !data.revokedAt);
    if (!current) return false;
    tx.update(current.ref, { status: "revoked", revokedAt: new Date(), revokedBy: revokedBy ? String(revokedBy) : null, updatedAt: new Date() });
    return true;
  });
};
const assignCustomerAccountIfUnassigned = async ({ userId, companyId, connectionId, customerId }) => {
  const ref = db.collection("google_ads_customer_assignments").doc(String(userId));
  return db.runTransaction(async (tx) => {
    await assertUserConnectionAvailable(tx, userId, connectionId, companyId);
    const current = await tx.get(ref);
    if (current.exists) {
      const assignment = current.data();
      return assignment.connectionId === connectionId && String(assignment.customerId) === String(customerId);
    }
    tx.create(ref, { userId: String(userId), companyId: companyId || null, connectionId, customerId: String(customerId), updatedAt: new Date() });
    return true;
  });
};
const assertUserConnectionAvailable = async (tx, userId, connectionId, companyId, assignedBy) => {
  const snapshot = await tx.get(db.collection(GOOGLE_ADS_CONNECTIONS).doc(connectionId));
  const connection = snapshot.data();
  if (!snapshot.exists || connection?.connected !== true) throw Object.assign(new Error("Google Ads connection is unavailable"), { status: 409 });
  if (companyId && connection.companyId && String(connection.companyId) !== String(companyId)) throw Object.assign(new Error("This connection belongs to another company"), { status: 409 });
  if (assignedBy && connection.nexionUserId && String(connection.nexionUserId) !== String(assignedBy)) throw Object.assign(new Error("This Google Ads connection belongs to a different Super Admin"), { status: 403 });
  return connection;
};
const getCustomerAssignment = async (userId) => {
  if (!userId) return null;
  const collection = db.collection("google_ads_customer_assignments");
  // New assignments are keyed by NEXION's authenticated userId. Read the
  // document first so older records without a duplicated userId field remain
  // accessible; then support legacy records stored under a different key.
  const direct = await collection.doc(String(userId)).get();
  if (direct.exists) {
    const data = direct.data();
    if (!data.userId || String(data.userId) === String(userId)) {
      if (!isRevokedAssignment(data) && (!data.status || data.status === "active")) return { id: direct.id, ...data, userId: String(userId) };
    }
  }
  const snap = await collection.where("userId", "==", String(userId)).limit(10).get();
  const active = snap.docs.find((doc) => !isRevokedAssignment(doc.data()) && (!doc.data().status || doc.data().status === "active"));
  return active ? { id: active.id, ...active.data() } : null;
};
const listCustomerAssignments = async () => {
  const snap = await db.collection("google_ads_customer_assignments").get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data(), userId: String(doc.data().userId || doc.id) }));
};
module.exports = {
  createGoogleAdsClient,
  updateGoogleAdsClient,
  listGoogleAdsClients,
  getGoogleAdsClient,
  assignGoogleAdsAccountToClient,
  revokeGoogleAdsClientAssignment,
  saveGoogleAdsConnection,
  saveClientGoogleAdsConnection,
  getGoogleAdsConnection,
  getCompanySharedGoogleAdsConnection,
  updateGoogleAdsCredentials,
  listGoogleAdsConnections,
  listGoogleAdsConnectionsForUser,
  saveOAuthState,
  getOAuthState,
  getPendingClientOAuthState,
  deleteOAuthState,
  consumeOAuthState,
  releaseOAuthState,
  completeOAuthState,
  createOAuthCompletion,
  consumeOAuthCompletion,
  assignCustomerAccount,
  revokeCustomerAssignment,
  assignCustomerAccountIfUnassigned,
  getCustomerAssignment,
  listCustomerAssignments,
};
