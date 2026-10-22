const {
  getCampaigns,
} = require("../services/googleAdsCampaignService");

const getCampaignList = async (req, res) => {
  try {
    const nexionUserId = req.query.userId;
    const customerId = req.query.customerId;

    const campaigns = await getCampaigns(
      nexionUserId,
      customerId
    );

    res.json({
      success: true,
      message: "Google Ads campaigns fetched successfully",
      nexionUserId,
      customerId,
      campaigns,
    });
  } catch (error) {
    console.error("Google Ads campaigns error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch Google Ads campaigns",
      error: error.message,
    });
  }
};

module.exports = {
  getCampaignList,
};


