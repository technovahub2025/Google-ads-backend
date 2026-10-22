const {
  editAdGroup,
  deleteAdGroup,
} = require("../services/googleAdsAdGroupManageService");


// EDIT AD GROUP
const editAdGroupController = async (req, res) => {
  try {
    const {
      userId,
      customerId,
      adGroupId,
      name,
    } = req.body;

    const result = await editAdGroup({
      nexionUserId: userId,
      customerId,
      adGroupId,
      name,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads ad group edit error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to edit Google Ads ad group",
      error: error.message,
    });
  }
};


// DELETE AD GROUP
const deleteAdGroupController = async (req, res) => {
  try {
    const {
      userId,
      customerId,
      adGroupId,
    } = req.body;

    const result = await deleteAdGroup({
      nexionUserId: userId,
      customerId,
      adGroupId,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads ad group delete error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete Google Ads ad group",
      error: error.message,
    });
  }
};


module.exports = {
  editAdGroupController,
  deleteAdGroupController,
};
