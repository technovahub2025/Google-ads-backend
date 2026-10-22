const express = require("express");

const {
  createCampaignController,
} = require("../controller/googleAdsCampaignCreateController");

const router = express.Router();

router.post("/campaigns", createCampaignController);

module.exports = router;