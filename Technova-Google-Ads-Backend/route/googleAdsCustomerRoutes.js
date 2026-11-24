const express = require("express");

const {
  getCustomerAccounts,
  getGoogleAdsHealth,
  getBilling,
} = require("../controller/googleAdsCustomerController");

const router = express.Router();

router.get("/customer-accounts", getCustomerAccounts);
router.get("/health", getGoogleAdsHealth);
router.get("/billing", getBilling);

module.exports = router;
