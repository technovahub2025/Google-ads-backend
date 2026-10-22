const express = require("express");

const {
  getCustomerAccounts,
} = require("../controller/googleAdsCustomerController");

const router = express.Router();

router.get("/customer-accounts", getCustomerAccounts);

module.exports = router;