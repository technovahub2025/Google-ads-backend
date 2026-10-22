const express = require("express");

const {
  editKeywordController,
  deleteKeywordController,
} = require("../controller/googleAdsKeywordManageController");

const router = express.Router();

router.put(
  "/keywords/edit",
  editKeywordController
);

router.delete(
  "/keywords/delete",
  deleteKeywordController
);

module.exports = router;