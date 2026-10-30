const express = require("express");
const { listGoogleAdsConnections, getCustomerAssignment, assignCustomerAccount, getGoogleAdsConnection, listCustomerAssignments } = require("../model/GoogleAdsConnection");

const router = express.Router();
const { getAccessibleCustomerAccounts } = require("../services/googleAdsCustomerService");

router.get("/connection", async (req, res) => {
  try {
    const connections = req.user.role === "superadmin"
      ? await listGoogleAdsConnections()
      : await (async () => {
        const assignment = await getCustomerAssignment(req.user.userId);
        if (!assignment) return [];
        const connection = await getGoogleAdsConnection(assignment.connectionId);
        return connection ? [{ connectionId: assignment.connectionId, connected: connection.connected === true }] : [];
      })();

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

router.get("/customer-assignments", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  return res.json({ success: true, assignments: await listCustomerAssignments() });
});

router.post("/customer-assignments", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  const { userId, connectionId, customerId } = req.body || {};
  if (!userId || !connectionId || !customerId) return res.status(400).json({ success: false, message: "userId, connectionId, and customerId are required" });
  const connection = await getGoogleAdsConnection(connectionId);
  if (!connection) return res.status(404).json({ success: false, message: "Google Ads connection not found" });
  const accounts = await getAccessibleCustomerAccounts(connectionId);
  const isAccessible = accounts.some((account) => String(account?.customer?.id || account?.customer?.resourceName?.split("/").pop() || account?.id) === String(customerId));
  if (!isAccessible) return res.status(404).json({ success: false, message: "Google Ads customer account not found for this connection" });
  await assignCustomerAccount({ userId, companyId: null, connectionId, customerId });
  return res.json({ success: true, assignment: { userId: String(userId), companyId: null, connectionId, customerId: String(customerId) } });
});

module.exports = router;
