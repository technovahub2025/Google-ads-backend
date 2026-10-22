const {
  editCampaignBudget,
  deleteCampaignBudget,
} = require("../services/googleAdsCampaignBudgetManageService");


// EDIT CAMPAIGN BUDGET
const editCampaignBudgetController = async (req, res) => {
  try {
    const {
      userId,
      customerId,
      budgetId,
      budgetAmount,
    } = req.body;

    const result = await editCampaignBudget({
      nexionUserId: userId,
      customerId,
      budgetId,
      budgetAmount,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads campaign budget edit error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to edit Google Ads campaign budget",
      error: error.message,
    });
  }
};


// DELETE CAMPAIGN BUDGET
const deleteCampaignBudgetController = async (req, res) => {
  try {
    const {
      userId,
      customerId,
      budgetId,
    } = req.body;

    const result = await deleteCampaignBudget({
      nexionUserId: userId,
      customerId,
      budgetId,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads campaign budget delete error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete Google Ads campaign budget",
      error: error.message,
    });
  }
};


module.exports = {
  editCampaignBudgetController,
  deleteCampaignBudgetController,
};
