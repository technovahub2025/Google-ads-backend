const service = require('../services/googleAdsManagementService');

const handle = (action, kind) => async (req, res) => {
  try {
    const input = req.method === 'GET' ? req.query : req.body;
    const result = action === 'list' ? await service.list(kind, input) : await service[action](input);
    res.json(action === 'list' ? result : { success: true, data: result, message: result.message });
  } catch (error) {
    if (action === 'deleteCampaignBudget' && error.code === 'CAMPAIGN_BUDGET_IN_USE') {
      return res.status(409).json({
        success: false, code: error.code, message: error.message, budgetId: error.budgetId, campaigns: error.campaigns,
        ...(error.diagnosticId ? { diagnosticId: error.diagnosticId } : {}),
      });
    }
    res.status(error.status || 500).json({ success: false, message: error.message || 'Google Ads operation failed', ...(error.diagnosticId ? { diagnosticId: error.diagnosticId } : {}), ...(error.creationUncertain ? { creationUncertain: true } : {}), ...(error.campaignId ? { campaignId: error.campaignId } : {}) });
  }
};
module.exports = { handle };
