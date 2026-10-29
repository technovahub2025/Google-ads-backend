const {
  editAd,
  deleteAd,
} = require("../services/googleAdsAdManageService");


// EDIT AD
const editAdController = async (req, res) => {
  try {
    const {
      connectionId,
      customerId,
      adId,
      headlines,
      descriptions,
      finalUrl,
    } = req.body;

    const result = await editAd({
      connectionId: connectionId,
      customerId,
      adId,
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
    console.error("Google Ads ad edit error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to edit Google Ads ad",
      error: error.message,
    });
  }
};


// DELETE AD
const deleteAdController = async (req, res) => {
  try {
    const {
      connectionId,
      customerId,
      adId,
    } = req.body;

    const result = await deleteAd({
      connectionId: connectionId,
      customerId,
      adId,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads ad delete error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete Google Ads ad",
      error: error.message,
    });
  }
};


module.exports = {
  editAdController,
  deleteAdController,
};
