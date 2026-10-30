const crypto = require("crypto");
const {
  googleOAuthClient,
  GOOGLE_ADS_SCOPE,
} = require("../config/googleOAuth");
const { saveGoogleAdsConnection, saveOAuthState, consumeOAuthState } = require("../model/GoogleAdsConnection");

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

const createOAuthState = () => {
  const payload = `${Date.now()}.${crypto.randomBytes(32).toString("hex")}`;
  const signature = crypto
    .createHmac("sha256", process.env.GOOGLE_CLIENT_SECRET)
    .update(payload)
    .digest("hex");

  return `${payload}.${signature}`;
};

const isValidOAuthState = (state) => {
  if (typeof state !== "string") return false;

  const [timestamp, nonce, signature, ...extra] = state.split(".");
  if (!timestamp || !nonce || !signature || extra.length) return false;

  const issuedAt = Number(timestamp);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > OAUTH_STATE_MAX_AGE_MS || issuedAt > Date.now()) {
    return false;
  }

  const payload = `${timestamp}.${nonce}`;
  const expected = crypto
    .createHmac("sha256", process.env.GOOGLE_CLIENT_SECRET)
    .update(payload)
    .digest("hex");
  const providedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

const getGoogleAdsAuthUrl = async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required to connect a Manager Account" });
  try {
    const state = createOAuthState();
    await saveOAuthState(state, req.user, new Date(Date.now() + OAUTH_STATE_MAX_AGE_MS));
    const authUrl = googleOAuthClient.generateAuthUrl({
      access_type: "offline",
      scope: [GOOGLE_ADS_SCOPE],
      prompt: "select_account consent",
      state,
    });
    return res.json({ success: true, authUrl });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Failed to start Google Ads authorization" });
  }
};

const googleAdsOAuthCallback = async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Google Ads authorization was not completed",
      });
    }

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Authorization code is missing",
      });
    }

    if (!isValidOAuthState(state)) {
      return res.status(400).json({
        success: false,
        message: "OAuth state is invalid or expired",
      });
    }

    const identity = await consumeOAuthState(state);
    if (!identity) return res.status(400).json({ success: false, message: "OAuth state is invalid or expired" });

    const { tokens } = await googleOAuthClient.getToken(code);
    if (!tokens?.refresh_token) {
      return res.status(400).json({
        success: false,
        message: "Refresh token was not received",
      });
    }

    const connectionId = await saveGoogleAdsConnection({
      refreshToken: tokens.refresh_token,
      nexionUserId: identity.nexionUserId,
      companyId: identity.companyId,
    });

    return res.json({
      success: true,
      message: "Google Ads authorization successful",
      connectionSaved: true,
      connectionId,
    });
  } catch (callbackError) {
    console.error("Google OAuth callback failed");

    return res.status(500).json({
      success: false,
      message: "Google Ads authorization failed",
    });
  }
};

module.exports = {
  getGoogleAdsAuthUrl,
  googleAdsOAuthCallback,
};
