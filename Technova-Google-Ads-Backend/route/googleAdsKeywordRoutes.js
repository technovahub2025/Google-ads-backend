const express = require("express");

const {
  createKeywordController,
} = require("../controller/googleAdsKeywordController");

const router = express.Router();

router.post("/keywords", createKeywordController);

const { handle } = require("../controller/googleAdsManagementController");
router.get("/keywords", handle("list", "keywords"));
module.exports = router;
