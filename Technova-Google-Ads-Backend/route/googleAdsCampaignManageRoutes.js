const express = require("express");

const {
  editCampaignController,
  deleteCampaignController,
} = require("../controller/googleAdsCampaignManageController");

const router = express.Router();

router.put(
  "/campaigns/edit",
  editCampaignController
);

router.delete(
  "/campaigns/delete",
  deleteCampaignController
);

module.exports = router;