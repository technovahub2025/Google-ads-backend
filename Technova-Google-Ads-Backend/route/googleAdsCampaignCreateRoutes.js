const express = require("express");

const {
  createCampaignController,
} = require("../controller/googleAdsCampaignCreateController");

const { handle } = require("../controller/googleAdsManagementController");

const router = express.Router();

router.get("/campaigns/creation-options", handle("campaignCreationOptions"));
router.post("/campaigns", createCampaignController);

module.exports = router;