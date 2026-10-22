const express = require("express");

const {
  createCampaignBudgetController,
} = require("../controller/googleAdsCampaignBudgetController");

const router = express.Router();

router.post(
  "/campaign-budgets",
  createCampaignBudgetController
);

module.exports = router;