const express = require("express");

const {
  getCampaignReportController,
} = require("../controller/googleAdsReportController");

const router = express.Router();

router.get("/reports/campaigns", getCampaignReportController);

module.exports = router;