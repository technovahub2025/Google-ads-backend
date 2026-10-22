const express = require("express");

const {
  editCampaignBudgetController,
  deleteCampaignBudgetController,
} = require("../controller/googleAdsCampaignBudgetManageController");

const router = express.Router();

router.put(
  "/campaign-budgets/edit",
  editCampaignBudgetController
);

router.delete(
  "/campaign-budgets/delete",
  deleteCampaignBudgetController
);

module.exports = router;