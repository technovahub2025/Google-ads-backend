const express = require("express");
const { listGoogleAdsConnections, getCustomerAssignment, assignCustomerAccount, revokeCustomerAssignment, getGoogleAdsConnection, listCustomerAssignments, createGoogleAdsClient, listGoogleAdsClients, getGoogleAdsClient, getPendingClientOAuthState, deleteOAuthState, assignGoogleAdsAccountToClient, revokeGoogleAdsClientAssignment } = require("../model/GoogleAdsConnection");
const { createClientOAuthInvitation } = require("../controller/googleAdsAuthController");
const { sendClientGoogleAdsInvitation } = require("../services/resendEmailService");
const { getAccessTokenForConnection } = require("../services/googleAdsAuthService");
const { updateGoogleAdsClient } = require("../model/GoogleAdsConnection");

const router = express.Router();
const { getAccessibleCustomerAccounts } = require("../services/googleAdsCustomerService");
const normalizeCustomerId = (value) => String(value || "").replace(/-/g, "");
const safeDirectoryMessage = (value) => String(value || "")
  .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
  .replace(/(token|secret|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]")
  .replace(/[\r\n\t]+/g, " ")
  .slice(0, 240);
const getNexionUsers = async (req) => {
  const baseUrl = String(process.env.NEXION_ADMIN_BACKEND_URL || "").replace(/\/$/, "");
  const authorization = req.get?.("authorization") || req.headers?.authorization;
  if (!baseUrl || !authorization) throw Object.assign(new Error("NEXION user directory is unavailable: backend URL or Super Admin authorization is missing"), { status: 503 });
  let endpoint;
  let origin;
  try { endpoint = `${baseUrl}/api/admin/google-ads/users`; origin = new URL(baseUrl).origin; }
  catch { throw Object.assign(new Error("NEXION_ADMIN_BACKEND_URL is not a valid URL"), { status: 503 }); }
  let response;
  try {
    response = await fetch(endpoint, { headers: { Authorization: authorization } });
  } catch (error) {
    console.error(JSON.stringify({ event: "google_ads_nexion_directory", outcome: "request_failed", origin, errorName: safeDirectoryMessage(error?.name || "Error") }));
    throw Object.assign(new Error("Unable to reach the NEXION user directory; check NEXION_ADMIN_BACKEND_URL and backend availability"), { status: 502 });
  }
  let payload;
  try { payload = await response.json(); }
  catch {
    console.error(JSON.stringify({ event: "google_ads_nexion_directory", outcome: "invalid_response", origin, upstreamStatus: response.status }));
    throw Object.assign(new Error(`NEXION user directory returned an invalid response (HTTP ${response.status})`), { status: 502 });
  }
  if (!response.ok) {
    const upstreamMessage = safeDirectoryMessage(payload?.message || payload?.error);
    const category = response.status === 401 ? "authentication_rejected" : response.status === 403 ? "super_admin_authorization_rejected" : "upstream_error";
    console.error(JSON.stringify({ event: "google_ads_nexion_directory", outcome: "rejected", origin, upstreamStatus: response.status, category, ...(upstreamMessage ? { upstreamMessage } : {}) }));
    const reason = upstreamMessage ? `: ${upstreamMessage}` : "";
    throw Object.assign(new Error(`NEXION user directory rejected the request (HTTP ${response.status})${reason}`), { status: response.status === 401 || response.status === 403 ? response.status : 502 });
  }
  if (!Array.isArray(payload?.data)) {
    console.error(JSON.stringify({ event: "google_ads_nexion_directory", outcome: "invalid_payload", origin, upstreamStatus: response.status }));
    throw Object.assign(new Error("NEXION user directory returned an unexpected response format"), { status: 502 });
  }
  console.info(JSON.stringify({ event: "google_ads_nexion_directory", outcome: "succeeded", origin, upstreamStatus: response.status, userCount: payload.data.length }));
  return payload.data.map((user) => ({
    ...user,
    userId: String(user.userId || user.id || user._id || ""),
  })).filter((user) => user.userId);
};

const getNexionAssignableUsers = async (req) =>
  (await getNexionUsers(req)).filter((user) => user.sidebarFeatureFlags?.googleAds === true
    && String(user.role || "").toLowerCase() !== "superadmin"
    && user.isActive !== false);

const safeAccountSummary = (account) => account && ({
  ...(account.id ? { id: String(account.id) } : {}),
  ...(account.name ? { name: String(account.name) } : {}),
  ...(account.currency ? { currency: String(account.currency) } : {}),
  ...(account.timeZone ? { timeZone: String(account.timeZone) } : {}),
  ...(typeof account.manager === "boolean" ? { manager: account.manager } : {}),
});

const discoveredAccountSummary = (account) => {
  const customer = account?.customer || account || {};
  return safeAccountSummary({
    id: customer.id,
    name: customer.name || customer.descriptive_name,
    currency: customer.currency || customer.currency_code,
    timeZone: customer.timeZone || customer.time_zone,
    manager: customer.manager,
  });
};

const safeConnectionSummary = (connection, { shared = false, includeOwnership = false } = {}) => ({
  connectionId: connection.id || connection.connectionId,
  connected: connection.connected === true,
  connectionStatus: connection.connectionStatus || (connection.connected ? "connected" : "disconnected"),
  ...(shared ? { shared: true } : {}),
  ...(includeOwnership ? { clientId: connection.clientId || null, companyId: connection.companyId || null, nexionUserId: connection.nexionUserId || null } : {}),
  ...(connection.customerId ? { customerId: String(connection.customerId) } : {}),
  ...(safeAccountSummary(connection.googleAccount) ? { googleAccount: safeAccountSummary(connection.googleAccount) } : {}),
  ...(Array.isArray(connection.googleAdsAccounts) ? { googleAdsAccounts: connection.googleAdsAccounts.map(safeAccountSummary).filter(Boolean) } : {}),
});

router.get("/clients", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  try {
    const clients = await listGoogleAdsClients();
    return res.json({ success: true, clients });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Failed to load Google Ads clients" });
  }
});

router.get("/nexion-users", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  try {
    const users = await getNexionAssignableUsers(req);
    return res.json({ success: true, users });
  } catch (error) {
    return res.status(error.status || 502).json({ success: false, message: error.message || "Unable to load NEXION users" });
  }
});

router.post("/clients", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  const { name, email, nexionUserId } = req.body || {};
  if (Object.keys(req.body || {}).some((key) => !["name", "email", "nexionUserId"].includes(key))) {
    return res.status(400).json({ success: false, message: "Only client name, email, and NEXION user ID are accepted" });
  }
  if (![name, email].every((value) => typeof value === "string" && value.trim())) {
    return res.status(400).json({ success: false, message: "name and email are required" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ success: false, message: "A valid email address is required" });
  try {
    let targetUser = null;
    if (nexionUserId) {
      const users = await getNexionAssignableUsers(req);
      targetUser = users.find((user) => String(user.userId) === String(nexionUserId));
      if (!targetUser || !targetUser.companyId) return res.status(404).json({ success: false, message: "The selected NEXION user was not found in a company" });
    }
    const result = await createGoogleAdsClient({ name, email, ...(targetUser ? { nexionUserId: targetUser.userId, companyId: targetUser.companyId } : {}) });
    const client = result.client || result;
    return res.status(result.created === false ? 200 : 201).json({ success: true, client, ...(result.created === false ? { reused: true } : {}) });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Failed to create Google Ads client" });
  }
});

router.patch("/clients/:clientId", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  const { name, email } = req.body || {};
  if (Object.keys(req.body || {}).some((key) => !["name", "email"].includes(key))) {
    return res.status(400).json({ success: false, message: "Only client name and email can be edited" });
  }
  if (![name, email].every((value) => typeof value === "string" && value.trim())) {
    return res.status(400).json({ success: false, message: "name and email are required" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ success: false, message: "A valid email address is required" });
  try {
    const client = await updateGoogleAdsClient({ clientId: req.params.clientId, name, email });
    if (!client) return res.status(404).json({ success: false, message: "Google Ads client not found" });
    return res.json({ success: true, client });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Failed to update Google Ads client" });
  }
});

router.post("/clients/:clientId/connect", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return res.status(503).json({ success: false, message: "Email service is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL." });
  }
  const entry = await getGoogleAdsClient(req.params.clientId);
  if (!entry) return res.status(404).json({ success: false, message: "Google Ads client not found" });
  const { client } = entry;
  if (!client.email) return res.status(400).json({ success: false, message: "Client email is missing" });
  const existingState = await getPendingClientOAuthState(client.clientId);
  let invitation;
  try {
    invitation = await createClientOAuthInvitation(client.clientId, existingState);
    await sendClientGoogleAdsInvitation({ to: client.email, clientName: client.name || "there", invitationUrl: invitation.invitationUrl });
    return res.json({ success: true, message: "Google Ads connection link sent to client email" });
  } catch (error) {
    if (invitation && !existingState) await deleteOAuthState(invitation.state).catch(() => {});
    const safeMessage = String(error?.message || "Unknown error").replace(process.env.RESEND_API_KEY || "\u0000", "[redacted]");
    console.error("Failed to send Google Ads connection email:", safeMessage);
    return res.status(500).json({ success: false, message: "Failed to send Google Ads connection email" });
  }
});

router.post("/clients/:clientId/account", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  const { nexionUserId, connectionId, customerId } = req.body || {};
  if (!nexionUserId || !connectionId || !customerId) return res.status(400).json({ success: false, message: "nexionUserId, connectionId, and customerId are required" });
  const normalizedCustomerId = normalizeCustomerId(customerId);
  if (!/^\d{10}$/.test(normalizedCustomerId)) return res.status(400).json({ success: false, message: "Google Ads Customer ID must contain exactly 10 digits" });
  try {
    const users = await getNexionAssignableUsers(req);
    const targetUser = users.find((user) => String(user.userId) === String(nexionUserId));
    if (!targetUser || !targetUser.companyId) return res.status(404).json({ success: false, message: "The selected NEXION user was not found in a company" });
    const clientEntry = await getGoogleAdsClient(req.params.clientId);
    if (!clientEntry) return res.status(404).json({ success: false, message: "Google Ads client not found" });
    const linkedUserId = clientEntry.client.nexionUserId || clientEntry.client.userId;
    if (linkedUserId && String(linkedUserId) !== String(targetUser.userId)) return res.status(409).json({ success: false, message: "This Google Ads client profile is already linked to another NEXION user" });
    if (clientEntry.client.companyId && String(clientEntry.client.companyId) !== String(targetUser.companyId)) return res.status(403).json({ success: false, message: "The selected NEXION user belongs to a different company than this client" });
    const connection = await getGoogleAdsConnection(connectionId);
    if (!connection?.connected) return res.status(404).json({ success: false, message: "Google Ads connection not found or disconnected" });
    if (connection.companyId && String(connection.companyId) !== String(targetUser.companyId)) return res.status(403).json({ success: false, message: "This Google Ads connection is authorized for a different company" });
    if (connection.clientId && String(connection.clientId) !== String(req.params.clientId)) return res.status(409).json({ success: false, message: "This Google Ads connection is linked to a different client" });
    if (connection.clientId && connection.nexionUserId && String(connection.nexionUserId) !== String(nexionUserId) && String(connection.clientId) !== String(req.params.clientId)) return res.status(409).json({ success: false, message: "This Google Ads connection is assigned to another NEXION user" });
    if (!connection.clientId && connection.nexionUserId && String(connection.nexionUserId) !== String(req.user.userId)) return res.status(403).json({ success: false, message: "This Google Ads OAuth connection belongs to a different Super Admin" });
    const accounts = await getAccessibleCustomerAccounts(connectionId);
    const isAccessible = accounts.some((account) => normalizeCustomerId(account?.customer?.id || account?.customer?.resourceName?.split("/").pop() || account?.id) === normalizedCustomerId);
    if (!isAccessible) return res.status(404).json({ success: false, message: "Google Ads customer account not found for this connection" });
    const client = await assignGoogleAdsAccountToClient({ clientId: req.params.clientId, nexionUserId: targetUser.userId, companyId: targetUser.companyId, connectionId, customerId: normalizedCustomerId });
    if (!client) return res.status(404).json({ success: false, message: "Google Ads client not found" });
    return res.json({ success: true, client, assignment: { userId: String(targetUser.userId), companyId: String(targetUser.companyId), clientId: String(req.params.clientId), connectionId, customerId: normalizedCustomerId } });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Failed to assign Google Ads account to client" });
  }
});

router.delete("/clients/:clientId/assignment", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  try {
    const client = await revokeGoogleAdsClientAssignment({ clientId: req.params.clientId });
    if (!client) return res.status(404).json({ success: false, message: "Google Ads client not found" });
    return res.json({ success: true, client });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Failed to revoke Google Ads client assignment" });
  }
});

router.get("/connection", async (req, res) => {
  try {
    let connections = req.user.role === "superadmin"
      ? await listGoogleAdsConnections()
      : await (async () => {
        const assignment = await getCustomerAssignment(req.user.userId);
        if (!assignment?.connectionId || !assignment.customerId) return [];
        if (assignment.companyId && req.user.companyId && String(assignment.companyId) !== String(req.user.companyId)) return [];
        const connection = await getGoogleAdsConnection(assignment.connectionId);
        if (!connection?.connected) return [];
        // The active assignment keyed by the signed JWT userId is the access boundary.
        return [{ ...safeConnectionSummary(connection, { shared: true }), customerId: String(assignment.customerId) }];
      })();

    // Active status checks maintain tokens without sending invitations. Limit concurrency.
    const active = connections.filter((connection) => connection.connected);
    for (let index = 0; index < active.length; index += 5) {
      await Promise.allSettled(active.slice(index, index + 5).map((connection) => getAccessTokenForConnection(connection.connectionId)));
    }
    connections = await Promise.all(connections.map(async (connection) => {
      const current = await getGoogleAdsConnection(connection.connectionId);
      let googleAdsAccounts = Array.isArray(current?.googleAdsAccounts) ? current.googleAdsAccounts : [];
      if (connection.shared && googleAdsAccounts.length === 0 && current?.connected) {
        try {
          googleAdsAccounts = (await getAccessibleCustomerAccounts(connection.connectionId)).map(discoveredAccountSummary).filter(Boolean);
        } catch (_) { /* Connection status remains available if account metadata discovery is temporarily unavailable. */ }
      }
      const customerId = connection.customerId || current?.customerId || (googleAdsAccounts.length === 1 ? googleAdsAccounts[0].id : null);
      const assignedAccount = googleAdsAccounts.find((account) => String(account.id).replace(/-/g, "") === String(customerId || "").replace(/-/g, ""));
      const googleAccount = assignedAccount || (String(current?.customerId || "").replace(/-/g, "") === String(customerId || "").replace(/-/g, "") ? current?.googleAccount : null) || { id: String(customerId) };
      const visibleAccounts = req.user.role === "superadmin" ? googleAdsAccounts : (customerId ? [googleAccount] : []);
      return safeConnectionSummary({ ...connection, ...current, id: connection.connectionId, customerId, googleAccount, googleAdsAccounts: visibleAccounts }, { shared: connection.shared === true, includeOwnership: req.user.role === "superadmin" });
    }));

    return res.json({
      success: true,
      connected: connections.some((connection) => connection.connected),
      connections,
    });
  } catch (error) {
    console.error("Google Ads connection error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get Google Ads connections",
    });
  }
});

router.post("/my-customer-assignment", async (_req, res) =>
  res.status(403).json({ success: false, message: "Google Ads customer accounts are assigned by a Super Admin" }));

router.get("/customer-assignments", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  return res.json({ success: true, assignments: await listCustomerAssignments() });
});

router.post("/customer-assignments", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  const { userId, connectionId, customerId } = req.body || {};
  if (!userId || !connectionId || !customerId) return res.status(400).json({ success: false, message: "userId, connectionId, and customerId are required" });
  const normalizedCustomerId = normalizeCustomerId(customerId);
  if (!/^\d{10}$/.test(normalizedCustomerId)) return res.status(400).json({ success: false, message: "Google Ads Customer ID must contain exactly 10 digits" });
  let users;
  try { users = await getNexionAssignableUsers(req); }
  catch (error) { return res.status(error.status || 502).json({ success: false, message: error.message || "Unable to verify the selected NEXION user" }); }
  const targetUser = users.find((user) => String(user.userId || user.id || user._id || "") === String(userId));
  if (!targetUser) return res.status(404).json({ success: false, message: "The selected NEXION user was not found" });
  const authenticatedUserId = String(targetUser.userId || targetUser.id || targetUser._id);
  const connection = await getGoogleAdsConnection(connectionId);
  if (!connection?.connected) return res.status(404).json({ success: false, message: "Google Ads connection not found or disconnected" });
  if (connection.companyId && targetUser.companyId && String(connection.companyId) !== String(targetUser.companyId)) return res.status(403).json({ success: false, message: "This Google Ads connection is authorized for a different company" });
  if (connection.nexionUserId && String(connection.nexionUserId) !== String(req.user.userId)) return res.status(403).json({ success: false, message: "This Google Ads OAuth connection belongs to a different Super Admin" });
  const accounts = await getAccessibleCustomerAccounts(connectionId);
  const isAccessible = accounts.some((account) => normalizeCustomerId(account?.customer?.id || account?.customer?.resourceName?.split("/").pop() || account?.id) === normalizedCustomerId);
  if (!isAccessible) return res.status(404).json({ success: false, message: "Google Ads customer account not found for this connection" });
  await assignCustomerAccount({ userId: authenticatedUserId, connectionId, customerId: normalizedCustomerId, assignedBy: req.user.userId });
  return res.json({ success: true, assignment: { userId: authenticatedUserId, connectionId, customerId: normalizedCustomerId, status: "active", assignedBy: String(req.user.userId) } });
});

router.delete("/customer-assignments/:userId", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  try {
    const revoked = await revokeCustomerAssignment({ userId: req.params.userId, revokedBy: req.user.userId });
    if (!revoked) return res.status(404).json({ success: false, message: "Active Google Ads assignment not found" });
    return res.json({ success: true, userId: String(req.params.userId), status: "revoked" });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Failed to revoke Google Ads assignment" });
  }
});

module.exports = router;
