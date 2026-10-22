const express = require("express");

const {
  createAdGroupController,
} = require("../controller/googleAdsAdGroupController");

const router = express.Router();

router.post("/ad-groups", createAdGroupController);

module.exports = router;
