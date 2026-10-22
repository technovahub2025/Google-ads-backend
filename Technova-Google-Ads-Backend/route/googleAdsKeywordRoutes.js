const express = require("express");

const {
  createKeywordController,
} = require("../controller/googleAdsKeywordController");

const router = express.Router();

router.post("/keywords", createKeywordController);

module.exports = router;
