const NEXION_AUTH_URL = () => String(process.env.NEXION_AUTH_URL || "").replace(/\/$/, "");
const { getCustomerAssignment, getGoogleAdsConnection } = require("../model/GoogleAdsConnection");

const authorizeGoogleAdsAccount = async (req, res, next) => {
  try {
    if (["/auth", "/auth/callback"].includes(req.path)) return next();
    const isAdmin = req.user.role === "superadmin";
    const requestedConnection = req.query.connectionId || req.body?.connectionId;
    const requestedCustomer = req.query.customerId || req.body?.customerId;
    if (!isAdmin) {
      const assignment = await getCustomerAssignment(req.user.userId);
      if (!assignment) return res.status(404).json({ success: false, message: "Google Ads account assignment not found" });
      if ((requestedConnection && requestedConnection !== assignment.connectionId) || (requestedCustomer && String(requestedCustomer) !== String(assignment.customerId))) return res.status(403).json({ success: false, message: "Not authorized for the requested Google Ads account" });
      Object.defineProperty(req, "query", {
        configurable: true,
        value: { ...req.query, connectionId: assignment.connectionId, customerId: assignment.customerId },
      });
      if (req.body && typeof req.body === "object") { req.body.connectionId = assignment.connectionId; req.body.customerId = assignment.customerId; }
      if (!await getGoogleAdsConnection(assignment.connectionId)) return res.status(404).json({ success: false, message: "Google Ads connection not found" });
      return next();
    }
    if (requestedConnection && !await getGoogleAdsConnection(requestedConnection)) return res.status(404).json({ success: false, message: "Google Ads connection not found" });
    return next();
  } catch (_) { return res.status(500).json({ success: false, message: "Failed to authorize Google Ads account" }); }
};

const authenticateNexion = async (req, res, next) => {
  if (req.path === "/auth/callback") return next();
  const match = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "");
  if (!match) return res.status(401).json({ success: false, message: "Nexion authentication missing or invalid" });
  const baseUrl = NEXION_AUTH_URL();
  if (!baseUrl) return res.status(503).json({ success: false, message: "Authentication service unavailable" });
  try {
    const response = await fetch(`${baseUrl}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${match[1]}` },
      signal: AbortSignal.timeout(Number(process.env.NEXION_AUTH_TIMEOUT_MS || 5000)),
    });
    if (!response.ok) return res.status(401).json({ success: false, message: "Nexion authentication missing or invalid" });
    const payload = await response.json();
    const identity = payload?.data || payload?.user || payload;
    const userId = identity?.userId || identity?.id || identity?._id;
    if (payload?.success === false || !userId) return res.status(401).json({ success: false, message: "Nexion authentication missing or invalid" });
    req.user = {
      userId: String(userId), role: String(identity.role || "user").toLowerCase(),
      companyId: identity.companyId ? String(identity.companyId) : null,
      companyRole: identity.companyRole ? String(identity.companyRole).toLowerCase() : null,
      ...(identity.email ? { email: String(identity.email) } : {}),
    };
    return next();
  } catch (_) {
    return res.status(503).json({ success: false, message: "Authentication service unavailable" });
  }
};

module.exports = { authenticateNexion, authorizeGoogleAdsAccount };
