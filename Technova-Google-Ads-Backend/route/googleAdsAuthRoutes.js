const express = require("express");

const {
  getGoogleAdsAuthUrl,
  googleAdsOAuthCallback,
} = require("../controller/googleAdsAuthController");

const router = express.Router();

router.get("/auth", getGoogleAdsAuthUrl);

router.get("/auth/callback", googleAdsOAuthCallback);

module.exports = router;
