const NEXION_AUTH_URL = () => String(process.env.NEXION_AUTH_URL || process.env.NEXION_ADMIN_BACKEND_URL || "").replace(/\/$/, "");
const { getCustomerAssignment, getGoogleAdsConnection } = require("../model/GoogleAdsConnection");

const normalizeCustomerId = (value) => String(value || "").replace(/-/g, "");
const superAdminReads = new Set(["/connection", "/customer-accounts", "/health", "/campaigns", "/overview", "/auth", "/nexion-users", "/clients", "/customer-assignments", "/leads"]);

const canSuperAdminAccess = (method, path) => {
  if (method === "GET" || method === "HEAD") return superAdminReads.has(path);
  if (method === "POST") return path === "/clients" || path === "/customer-assignments" || path === "/lead-mappings" || /^\/clients\/[^/]+\/(connect|account)$/.test(path);
  if (method === "PATCH") return /^\/clients\/[^/]+$/.test(path) || /^\/leads\/[^/]+$/.test(path);
  return method === "DELETE" && /^(\/clients\/[^/]+\/assignment|\/customer-assignments\/[^/]+)$/.test(path);
};

const authorizeGoogleAdsAccount = async (req, res, next) => {
  try {
    if (req.path === "/auth/callback") return next();
    if (!req.user?.userId) return res.status(401).json({ success: false, message: "NEXION authentication missing or invalid" });
    const isAdmin = req.user.role === "superadmin";
    const path = req.path.replace(/\/+$/, "").toLowerCase();
    const isBilling = path === "/billing";
    if (isBilling) res.set("Cache-Control", "no-store");
    if (isAdmin && !canSuperAdminAccess(req.method, path)) {
      return res.status(403).json({ success: false, message: "Super Admin cannot manage Google Ads campaigns, budgets, ad groups, ads or keywords" });
    }
    if (path === "/auth") {
      if (isAdmin) return next();
      return res.status(403).json({ success: false, message: "Super Admin permission required to connect Google Ads accounts" });
    }
    if (isBilling && (Object.keys(req.query).length || Object.keys(req.body || {}).length)) {
      return res.status(400).json({ success: false, message: "Billing uses the Google Ads account assigned to your NEXION user." });
    }
    if (req.path === "/my-customer-assignment") {
      return res.status(403).json({ success: false, message: "Only a Super Admin can assign a Google Ads customer account" });
    }
    const requestedConnection = req.query.connectionId || req.body?.connectionId;
    const requestedCustomer = req.query.customerId || req.body?.customerId;
    // Check both sources: a permitted query parameter must never authorize a
    // different customer or connection hidden in a mutation's JSON body.
    if ((req.query.connectionId && req.body?.connectionId && req.query.connectionId !== req.body.connectionId) ||
        (req.query.customerId && req.body?.customerId && normalizeCustomerId(req.query.customerId) !== normalizeCustomerId(req.body.customerId))) {
      return res.status(403).json({ success: false, message: "Conflicting Google Ads account selection" });
    }
    if (!isAdmin && req.path === "/connection") return next();
    if (isAdmin && (path === "/campaigns" || path === "/overview")) {
      if (!requestedConnection || !requestedCustomer) return res.status(400).json({ success: false, message: "connectionId and customerId are required" });
      const customerId = normalizeCustomerId(requestedCustomer);
      if (typeof requestedConnection !== "string" || !/^\d{10}$/.test(customerId)) return res.status(400).json({ success: false, message: "A valid connection and 10-digit customer ID are required" });
      const connection = await getGoogleAdsConnection(requestedConnection);
      if (!connection?.connected) return res.status(404).json({ success: false, message: "Google Ads connection not found or disconnected" });
      const { getAccessibleCustomerAccounts } = require("../services/googleAdsCustomerService");
      const accounts = await getAccessibleCustomerAccounts(requestedConnection);
      const accessible = accounts.some((row) => {
        const customer = row.customer || row;
        return normalizeCustomerId(customer.id) === customerId && customer.manager !== true;
      });
      if (!accessible) return res.status(403).json({ success: false, message: "Customer is not authorized for this Google Ads connection" });
      return next();
    }
    if (!isAdmin) {
      const assignment = await getCustomerAssignment(req.user.userId);
      if (isBilling && (!assignment?.connectionId || !/^\d{10}$/.test(normalizeCustomerId(assignment.customerId)))) {
        return res.status(404).json({ success: false, code: "BILLING_ACCOUNT_NOT_ASSIGNED", message: "Ask your Super Admin to assign a Google Ads account to your NEXION user." });
      }
      if (!assignment) return res.status(404).json({ success: false, message: "Google Ads account assignment not found" });
      if (assignment.companyId && req.user.companyId && String(assignment.companyId) !== String(req.user.companyId)) return res.status(403).json({ success: false, message: "Google Ads assignment belongs to a different company" });
      if ((requestedConnection && requestedConnection !== assignment.connectionId) || (requestedCustomer && normalizeCustomerId(requestedCustomer) !== normalizeCustomerId(assignment.customerId))) return res.status(403).json({ success: false, message: "Not authorized for the requested Google Ads account" });
      const assignedConnection = await getGoogleAdsConnection(assignment.connectionId);
      if (isBilling) {
        if (assignedConnection?.connectionStatus === "reconnect_required" || (assignedConnection?.connected && !assignedConnection.refreshToken)) {
          return res.status(409).json({ success: false, code: "BILLING_AUTHORIZATION_REQUIRED", message: "Google Ads authorization has expired or been revoked. Ask your Super Admin to reconnect the account." });
        }
        if (!assignedConnection?.connected) {
          return res.status(409).json({ success: false, code: "BILLING_CONNECTION_DISCONNECTED", message: "Your assigned Google Ads account is disconnected. Ask your Super Admin to reconnect it." });
        }
        req.billingAccount = {
          connectionId: assignment.connectionId,
          customerId: normalizeCustomerId(assignment.customerId),
          managerCustomerId: assignedConnection.managerCustomerId,
        };
        return next();
      }
      if (!assignedConnection?.connected) return res.status(404).json({ success: false, message: "Google Ads connection not found or disconnected" });
      Object.defineProperty(req, "query", {
        configurable: true,
        value: { ...req.query, connectionId: assignment.connectionId, customerId: normalizeCustomerId(assignment.customerId) },
      });
      if (req.body && typeof req.body === "object") { req.body.connectionId = assignment.connectionId; req.body.customerId = normalizeCustomerId(assignment.customerId); }
      return next();
    }
    if (requestedConnection && !await getGoogleAdsConnection(requestedConnection)) return res.status(404).json({ success: false, message: "Google Ads connection not found" });
    return next();
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: "Unable to verify Google Ads account access", ...(error.diagnosticId ? { diagnosticId: error.diagnosticId } : {}) }); }
};

const authenticateNexion = async (req, res, next) => {
  if (req.path === "/auth/callback") return next();
  const match = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "");
  if (!match) return res.status(401).json({ success: false, message: "Nexion authentication missing or invalid" });
  const baseUrl = NEXION_AUTH_URL();
  if (!baseUrl) return res.status(503).json({ success: false, message: "Authentication service unavailable" });
  try {
    const response = await fetch(`${baseUrl}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${match[1].trim().replace(/^(?:Bearer\s+)+/i, "")}` },
      signal: AbortSignal.timeout(Number(process.env.NEXION_AUTH_TIMEOUT_MS || 5000)),
    });
    if (!response.ok) return res.status(response.status === 401 ? 401 : 503).json({ success: false, message: response.status === 401 ? "Nexion authentication missing or invalid" : "Authentication service unavailable" });
    const payload = await response.json();
    const identity = payload?.data || payload?.user || payload;
    const userId = identity?.userId || identity?.id || identity?._id;
    if (payload?.success === false || !userId) return res.status(401).json({ success: false, message: "Nexion authentication missing or invalid" });
    req.user = {
      userId: String(userId), role: String(identity.role || "user").toLowerCase(),
      companyId: identity.companyId || identity.company_id || identity.tenantId || identity.tenant_id
        ? String(identity.companyId || identity.company_id || identity.tenantId || identity.tenant_id)
        : null,
      companyRole: identity.companyRole ? String(identity.companyRole).toLowerCase() : null,
      ...(identity.email ? { email: String(identity.email) } : {}),
      ...(identity.username ? { username: String(identity.username) } : {}),
    };
    if (req.user.role !== "superadmin" && identity.sidebarFeatureFlags?.googleAds !== true) {
      return res.status(403).json({ success: false, message: "Google Ads module access has not been granted" });
    }
    return next();
  } catch (_) {
    return res.status(503).json({ success: false, message: "Authentication service unavailable" });
  }
};

module.exports = { authenticateNexion, authorizeGoogleAdsAccount };
