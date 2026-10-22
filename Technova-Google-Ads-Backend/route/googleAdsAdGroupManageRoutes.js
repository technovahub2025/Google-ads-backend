const express = require("express");

const {
  editAdGroupController,
  deleteAdGroupController,
} = require("../controller/googleAdsAdGroupManageController");

const router = express.Router();

router.put(
  "/ad-groups/edit",
  editAdGroupController
);

router.delete(
  "/ad-groups/delete",
  deleteAdGroupController
);

module.exports = router;