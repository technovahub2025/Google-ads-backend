const express = require("express");

const {
  createCampaignBudgetController,
} = require("../controller/googleAdsCampaignBudgetController");

const router = express.Router();

router.post(
  "/campaign-budgets",
  createCampaignBudgetController
);

const { handle } = require("../controller/googleAdsManagementController");
router.get("/campaign-budgets", handle("list", "budgets"));
module.exports = router;
