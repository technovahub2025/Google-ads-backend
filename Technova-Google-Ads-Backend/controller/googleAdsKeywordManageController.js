const { handle } = require('./googleAdsManagementController');
module.exports = { editKeywordController: handle('editKeyword'), deleteKeywordController: handle('deleteKeyword') };
