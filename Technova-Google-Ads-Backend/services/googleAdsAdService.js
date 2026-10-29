const { GoogleAdsApi } = require("google-ads-api");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const createAd = async ({
  connectionId,
  customerId,
  adGroupId,
  headlines,
  descriptions,
  finalUrl,
}) => {
  const connection = await getGoogleAdsConnection(connectionId);

  if (!connection) {
    throw new Error("Google Ads connection not found");
  }

  if (!connection.refreshToken) {
    throw new Error("Google Ads refresh token not found");
  }

  if (!customerId) {
    throw new Error("Google Ads customer ID is required");
  }

  if (!adGroupId) {
    throw new Error("Ad group ID is required");
  }

  if (!Array.isArray(headlines) || headlines.length === 0) {
    throw new Error("At least one headline is required");
  }

  if (!Array.isArray(descriptions) || descriptions.length === 0) {
    throw new Error("At least one description is required");
  }

  if (!finalUrl) {
    throw new Error("Final URL is required");
  }

  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  });

  const customer = client.Customer({
    customer_id: customerId,
    refresh_token: connection.refreshToken,
  });

  return {
    success: true,
    connectionId,
    customerId,
    adGroupId,
    headlines,
    descriptions,
    finalUrl,
    message: "Ad creation request validated",
  };
};

module.exports = {
  createAd,
};