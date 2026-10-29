const {
  getAccessibleCustomerAccounts,
} = require("../services/googleAdsCustomerService");

const getCustomerAccounts = async (req, res) => {
  try {
    const connectionId = req.query.connectionId;

    const accounts = await getAccessibleCustomerAccounts(connectionId);

    res.json({
      success: true,
      message: "Google Ads customer accounts fetched successfully",
      connectionId,
      accounts,
    });
  } catch (error) {
    console.error("Google Ads customer accounts error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch Google Ads customer accounts",
      error: error.message,
    });
  }
};

module.exports = {
  getCustomerAccounts,
};


