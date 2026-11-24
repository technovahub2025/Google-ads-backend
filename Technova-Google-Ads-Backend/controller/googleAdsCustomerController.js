const {
  getAccessibleCustomerAccounts,
} = require("../services/googleAdsCustomerService");
const { getCustomerAssignment } = require("../model/GoogleAdsConnection");
const { checkGoogleAdsHealth } = require("../services/googleAdsHealthService");
const { getGoogleAdsBilling, reconnectRequired } = require("../services/googleAdsBillingService");
const normalizeCustomerId = (value) => String(value || "").replace(/-/g, "");

const getCustomerAccounts = async (req, res) => {
  try {
    const connectionId = req.query.connectionId;

    let accounts = await getAccessibleCustomerAccounts(connectionId || req.query.connectionId);
    if (req.user.role !== "superadmin") {
      const assignment = await getCustomerAssignment(req.user.userId);
      if (assignment) accounts = accounts.filter((account) => normalizeCustomerId(account?.customer?.id || account?.customer?.resourceName?.split("/").pop() || account?.id) === normalizeCustomerId(assignment.customerId));
    }

    res.json({
      success: true,
      message: "Google Ads customer accounts fetched successfully",
      connectionId,
      accounts,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to fetch Google Ads customer accounts",
      error: error.category || "Google Ads customer account lookup failed",
      ...(error.diagnosticId ? { diagnosticId: error.diagnosticId } : {}),
    });
  }
};

const getGoogleAdsHealth = async (req, res) => {
  const result = await checkGoogleAdsHealth({ connectionId: req.query.connectionId, customerId: req.query.customerId });
  return res.json(result);
};

const getBilling = async (req, res) => {
  try {
    const billing = await getGoogleAdsBilling(req.billingAccount);
    return res.json({ success: true, billing });
  } catch (error) {
    const diagnostic = error.diagnosticId ? { diagnosticId: error.diagnosticId } : {};
    if (reconnectRequired(error)) {
      return res.status(409).json({
        success: false, code: "BILLING_AUTHORIZATION_REQUIRED",
        message: "Google Ads authorization has expired or been revoked. Ask your Super Admin to reconnect the account.",
        ...diagnostic,
      });
    }
    if (error.category === "authorization_or_account_access" || error.code === "BILLING_ACCOUNT_ACCESS_DENIED") {
      return res.status(403).json({
        success: false, code: "BILLING_ACCOUNT_ACCESS_DENIED",
        message: "Google could not verify access to the assigned advertiser account. Ask your Super Admin to check its Google Ads account permissions.",
        ...diagnostic,
      });
    }
    return res.status(502).json({
      success: false, code: "BILLING_TEMPORARILY_UNAVAILABLE",
      message: "Google Ads billing is temporarily unavailable. Try again.",
      ...diagnostic,
    });
  }
};

module.exports = {
  getCustomerAccounts,
  getGoogleAdsHealth,
  getBilling,
};


