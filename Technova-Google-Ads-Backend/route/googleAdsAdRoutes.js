const express = require("express");

const {
  createAdController,
} = require("../controller/googleAdsAdController");

const router = express.Router();

router.post("/ads", createAdController);

const { handle } = require("../controller/googleAdsManagementController");
router.get("/ads", handle("list", "ads"));
module.exports = router;
