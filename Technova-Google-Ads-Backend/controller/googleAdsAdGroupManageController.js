const { handle } = require('./googleAdsManagementController');
module.exports = { editAdGroupController: handle('editAdGroup'), deleteAdGroupController: handle('deleteAdGroup') };
