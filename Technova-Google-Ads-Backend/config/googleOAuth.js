const { OAuth2Client } = require("google-auth-library");

const googleOAuthClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

module.exports = {
  googleOAuthClient,
  GOOGLE_ADS_SCOPE,
};
