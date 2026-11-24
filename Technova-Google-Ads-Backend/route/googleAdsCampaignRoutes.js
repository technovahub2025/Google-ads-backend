const express = require("express");

const {
  getCampaignList,
  getOverview,
} = require("../controller/googleAdsCampaignController");

const router = express.Router();

router.get("/overview", getOverview);
router.get("/campaigns", getCampaignList);

const { handle } = require("../controller/googleAdsManagementController");
router.get("/campaigns/settings", handle("list", "campaigns"));
module.exports = router;
