const express = require("express");

const {
  updateCampaignStatusController,
} = require("../controller/googleAdsCampaignStatusController");

const router = express.Router();

router.patch(
  "/campaigns/status",
  updateCampaignStatusController
);

module.exports = router;