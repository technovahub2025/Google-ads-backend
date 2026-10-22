const {
  getCampaignReport,
} = require("../services/googleAdsReportService");

const getCampaignReportController = async (req, res) => {
  try {
    const {
      userId,
      customerId,
      startDate,
      endDate,
    } = req.query;

    const result = await getCampaignReport({
      nexionUserId: userId,
      customerId,
      startDate,
      endDate,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads report error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch Google Ads report",
      error: error.message,
    });
  }
};

module.exports = {
  getCampaignReportController,
};


