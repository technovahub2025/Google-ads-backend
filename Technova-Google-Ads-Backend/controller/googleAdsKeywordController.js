const {
  createKeyword,
} = require("../services/googleAdsKeywordService");

const createKeywordController = async (req, res) => {
  try {
    const {
      userId,
      customerId,
      adGroupId,
      keyword,
      matchType,
    } = req.body;

    const result = await createKeyword({
      nexionUserId: userId,
      customerId,
      adGroupId,
      keyword,
      matchType,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads keyword error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create Google Ads keyword",
      error: error.message,
    });
  }
};

module.exports = {
  createKeywordController,
};
