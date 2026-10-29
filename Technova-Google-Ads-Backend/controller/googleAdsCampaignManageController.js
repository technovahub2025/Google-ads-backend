const {
  editCampaign,
  deleteCampaign,
} = require("../services/googleAdsCampaignManageService");


// EDIT CAMPAIGN
const editCampaignController = async (req, res) => {
  try {
    const {
      connectionId,
      customerId,
      campaignId,
      name,
    } = req.body;

    const result = await editCampaign({
      connectionId: connectionId,
      customerId,
      campaignId,
      name,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads campaign edit error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to edit Google Ads campaign",
      error: error.message,
    });
  }
};


// DELETE CAMPAIGN
const deleteCampaignController = async (req, res) => {
  try {
    const {
      connectionId,
      customerId,
      campaignId,
    } = req.body;

    const result = await deleteCampaign({
      connectionId: connectionId,
      customerId,
      campaignId,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads campaign delete error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete Google Ads campaign",
      error: error.message,
    });
  }
};


module.exports = {
  editCampaignController,
  deleteCampaignController,
};
