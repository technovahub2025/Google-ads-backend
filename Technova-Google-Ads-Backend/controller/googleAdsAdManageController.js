const {
  editAd,
  deleteAd,
} = require("../services/googleAdsAdManageService");


// EDIT AD
const editAdController = async (req, res) => {
  try {
    const {
      userId,
      customerId,
      adId,
      headlines,
      descriptions,
      finalUrl,
    } = req.body;

    const result = await editAd({
      nexionUserId: userId,
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
      userId,
      customerId,
      adId,
    } = req.body;

    const result = await deleteAd({
      nexionUserId: userId,
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
