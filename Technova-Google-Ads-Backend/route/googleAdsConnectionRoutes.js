const express = require("express");
const { listGoogleAdsConnections } = require("../model/GoogleAdsConnection");

const router = express.Router();

router.get("/connection", async (req, res) => {
  try {
    const connections = await listGoogleAdsConnections();

    return res.json({
      success: true,
      connected: connections.some((connection) => connection.connected),
      connections,
    });
  } catch (error) {
    console.error("Google Ads connection error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get Google Ads connections",
    });
  }
});

module.exports = router;
