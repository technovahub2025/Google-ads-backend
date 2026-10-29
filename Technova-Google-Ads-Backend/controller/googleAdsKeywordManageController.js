const {
  editKeyword,
  deleteKeyword,
} = require("../services/googleAdsKeywordManageService");


// EDIT KEYWORD
const editKeywordController = async (req, res) => {
  try {
    const {
      connectionId,
      customerId,
      keywordId,
      keyword,
      matchType,
    } = req.body;

    const result = await editKeyword({
      connectionId: connectionId,
      customerId,
      keywordId,
      keyword,
      matchType,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads keyword edit error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to edit Google Ads keyword",
      error: error.message,
    });
  }
};


// DELETE KEYWORD
const deleteKeywordController = async (req, res) => {
  try {
    const {
      connectionId,
      customerId,
      keywordId,
    } = req.body;

    const result = await deleteKeyword({
      connectionId: connectionId,
      customerId,
      keywordId,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads keyword delete error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete Google Ads keyword",
      error: error.message,
    });
  }
};


module.exports = {
  editKeywordController,
  deleteKeywordController,
};
