const {
  createCampaignBudget,
} = require("../services/googleAdsCampaignBudgetService");

const createCampaignBudgetController = async (req, res) => {
  try {
    const {
      userId,
      customerId,
      budgetAmount,
    } = req.body;

    const result = await createCampaignBudget({
      nexionUserId: userId,
      customerId,
      budgetAmount,
    });

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("Google Ads campaign budget error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create Google Ads campaign budget",
      error: error.message,
    });
  }
};

module.exports = {
  createCampaignBudgetController,
};

