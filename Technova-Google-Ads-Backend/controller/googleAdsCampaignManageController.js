const { handle } = require('./googleAdsManagementController');
module.exports = { editCampaignController: handle('editCampaign'), deleteCampaignController: handle('deleteCampaign') };
