const {
  googleOAuthClient,
  GOOGLE_ADS_SCOPE,
} = require("../config/googleOAuth");

const {
  saveGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const getGoogleAdsAuthUrl = (req, res) => {
  const nexionUserId = req.query.userId;

  if (!nexionUserId) {
    return res.status(400).json({
      success: false,
      message: "Nexion user ID is required",
    });
  }

  const authUrl = googleOAuthClient.generateAuthUrl({
    access_type: "offline",
    scope: [GOOGLE_ADS_SCOPE],
    prompt: "select_account consent",
    state: nexionUserId,
  });

  res.json({
    success: true,
    authUrl,
  });
};

const googleAdsOAuthCallback = async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Authorization code is missing",
      });
    }

    if (!state) {
      return res.status(400).json({
        success: false,
        message: "Nexion user ID is missing",
      });
    }

    const { tokens } = await googleOAuthClient.getToken(code);

    console.log("Google OAuth completed");
    console.log(
      "Access token received:",
      !!tokens.access_token
    );
    console.log(
      "Refresh token received:",
      !!tokens.refresh_token
    );

    if (!tokens.refresh_token) {
      return res.status(400).json({
        success: false,
        message: "Refresh token was not received",
      });
    }

    await saveGoogleAdsConnection({
      nexionUserId: state,
      refreshToken: tokens.refresh_token,
    });

    console.log(
      "Google Ads connection saved for user:",
      state
    );

    res.json({
      success: true,
      message: "Google Ads authorization successful",
      connectionSaved: true,
      nexionUserId: state,
    });
  } catch (error) {
    console.error(
      "Google OAuth callback error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      success: false,
      message: "Google Ads authorization failed",
    });
  }
};

module.exports = {
  getGoogleAdsAuthUrl,
  googleAdsOAuthCallback,
};