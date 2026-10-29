const {
  googleOAuthClient,
} = require("../config/googleOAuth");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const getAccessTokenForConnection = async (connectionId) => {
  const connection = await getGoogleAdsConnection(connectionId);

  if (!connection) {
    throw new Error("Google Ads connection not found");
  }

  if (!connection.refreshToken) {
    throw new Error("Google Ads refresh token not found");
  }

  googleOAuthClient.setCredentials({
    refresh_token: connection.refreshToken,
  });

  const { token } = await googleOAuthClient.getAccessToken();

  if (!token) {
    throw new Error("Unable to generate Google Ads access token");
  }

  return token;
};

module.exports = {
  getAccessTokenForConnection,
};