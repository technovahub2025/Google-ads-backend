const { GoogleAdsApi } = require("google-ads-api");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const createKeyword = async ({
  connectionId,
  customerId,
  adGroupId,
  keyword,
  matchType = "BROAD",
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

  if (!keyword) {
    throw new Error("Keyword is required");
  }

  const allowedMatchTypes = [
    "BROAD",
    "PHRASE",
    "EXACT",
  ];

  if (!allowedMatchTypes.includes(matchType)) {
    throw new Error(
      "Match type must be BROAD, PHRASE, or EXACT"
    );
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
    keyword,
    matchType,
    message: "Keyword request validated",
  };
};

module.exports = {
  createKeyword,
};
