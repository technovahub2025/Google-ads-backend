const express = require("express");

const {
  getCampaignList,
} = require("../controller/googleAdsCampaignController");

const router = express.Router();

router.get("/campaigns", getCampaignList);

module.exports = router;
