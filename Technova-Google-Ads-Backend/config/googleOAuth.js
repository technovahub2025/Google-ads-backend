const { OAuth2Client } = require("google-auth-library");

const createGoogleOAuthClient = () => new OAuth2Client({
  clientId: process.env.GOOGLE_CLIENT_ID,


  
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI,
  transporterOptions: { timeout: 30000 },
});
const googleOAuthClient = createGoogleOAuthClient();

const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

module.exports = {
  googleOAuthClient,
  createGoogleOAuthClient,
  GOOGLE_ADS_SCOPE,
};
