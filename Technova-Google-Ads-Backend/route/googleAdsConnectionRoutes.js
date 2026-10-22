const express = require("express");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const router = express.Router();

router.get("/connection", async (req, res) => {
  try {
    const nexionUserId = req.query.userId;

    if (!nexionUserId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    const connection = await getGoogleAdsConnection(nexionUserId);

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: "Google Ads connection not found",
        nexionUserId,
      });
    }

    res.json({
      success: true,
      nexionUserId: connection.nexionUserId,
      connected: connection.connected,
      hasRefreshToken: !!connection.refreshToken,
      updatedAt: connection.updatedAt,
    });
  } catch (error) {
    console.error("Google Ads connection error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to get Google Ads connection",
    });
  }
});

module.exports = router;