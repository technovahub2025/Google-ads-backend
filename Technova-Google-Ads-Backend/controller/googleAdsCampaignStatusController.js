const {
  updateCampaignStatus,
} = require("../services/googleAdsCampaignStatusService");

const updateCampaignStatusController = async (req, res) => {
  try {
    const {
      userId,
      customerId,
      campaignId,
      status,
    } = req.body;

    const result = await updateCampaignStatus({
      nexionUserId: userId,
      customerId,
      campaignId,
      status,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads campaign status error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update Google Ads campaign status",
      error: error.message,
    });
  }
};

module.exports = {
  updateCampaignStatusController,
};
