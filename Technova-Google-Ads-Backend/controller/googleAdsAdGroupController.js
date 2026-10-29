const {
  createAdGroup,
} = require("../services/googleAdsAdGroupService");

const createAdGroupController = async (req, res) => {
  try {
    const {
      connectionId,
      customerId,
      campaignId,
      name,
      status,
    } = req.body;

    const result = await createAdGroup({
      connectionId: connectionId,
      customerId,
      campaignId,
      name,
      status,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads ad group error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create Google Ads ad group",
      error: error.message,
    });
  }
};

module.exports = {
  createAdGroupController,
};

