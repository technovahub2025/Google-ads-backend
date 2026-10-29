const {
  createAd,
} = require("../services/googleAdsAdService");

const createAdController = async (req, res) => {
  try {
    const {
      connectionId,
      customerId,
      adGroupId,
      headlines,
      descriptions,
      finalUrl,
    } = req.body;

    const result = await createAd({
      connectionId: connectionId,
      customerId,
      adGroupId,
      headlines,
      descriptions,
      finalUrl,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads ad creation error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create Google Ads ad",
      error: error.message,
    });
  }
};

module.exports = {
  createAdController,
};

