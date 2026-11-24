const express = require("express");

const {
  createAdGroupController,
} = require("../controller/googleAdsAdGroupController");

const router = express.Router();

router.post("/ad-groups", createAdGroupController);

const { handle } = require("../controller/googleAdsManagementController");
router.get("/ad-groups", handle("list", "adGroups"));
module.exports = router;
