const express = require("express");

const {
  editAdController,
  deleteAdController,
} = require("../controller/googleAdsAdManageController");

const router = express.Router();

router.put(
  "/ads/edit",
  editAdController
);

router.delete(
  "/ads/delete",
  deleteAdController
);

module.exports = router;