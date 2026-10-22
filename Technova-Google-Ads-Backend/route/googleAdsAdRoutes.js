const express = require("express");

const {
  createAdController,
} = require("../controller/googleAdsAdController");

const router = express.Router();

router.post("/ads", createAdController);

module.exports = router;