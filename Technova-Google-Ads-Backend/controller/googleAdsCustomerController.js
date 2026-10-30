const {
  getAccessibleCustomerAccounts,
} = require("../services/googleAdsCustomerService");
const { getCustomerAssignment } = require("../model/GoogleAdsConnection");

const getCustomerAccounts = async (req, res) => {
  try {
    const connectionId = req.query.connectionId;

    let accounts = await getAccessibleCustomerAccounts(connectionId || req.query.connectionId);
    if (req.user.role !== "superadmin") {
      const assignment = await getCustomerAssignment(req.user.userId);
      accounts = accounts.filter((account) => String(account?.customer?.id || account?.customer?.resourceName?.split("/").pop() || account?.id) === String(assignment?.customerId));
    }

    res.json({
      success: true,
      message: "Google Ads customer accounts fetched successfully",
      connectionId,
      accounts,
    });
  } catch (error) {
    console.error("Google Ads customer account lookup failed");

    res.status(500).json({
      success: false,
      message: "Failed to fetch Google Ads customer accounts",
      error: "Google Ads customer account lookup failed",
    });
  }
};

module.exports = {
  getCustomerAccounts,
};


