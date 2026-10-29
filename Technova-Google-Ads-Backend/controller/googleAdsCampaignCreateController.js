const {
  createCampaign,
} = require("../services/googleAdsCampaignCreateService");

const createCampaignController = async (req, res) => {
  try {
    const {
      connectionId,
      customerId,
      name,
      budgetAmount,
      status,
    } = req.body;

    const result = await createCampaign({
      connectionId: connectionId,
      customerId,
      name,
      budgetAmount,
      status,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads campaign creation error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create Google Ads campaign",
      error: error.message,
    });
  }
};

module.exports = {
  createCampaignController,
};
