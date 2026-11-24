const { handle } = require('./googleAdsManagementController');
module.exports = { editAdController: handle('editAd'), deleteAdController: handle('deleteAd') };
