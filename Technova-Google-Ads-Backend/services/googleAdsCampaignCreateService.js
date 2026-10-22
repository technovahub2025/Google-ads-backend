const { GoogleAdsApi } = require("google-ads-api");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const createCampaign = async ({
  nexionUserId,
  customerId,
  name,
  budgetAmount,
  status = "PAUSED",
}) => {
  const connection = await getGoogleAdsConnection(nexionUserId);

  if (!connection) {
    throw new Error("Google Ads connection not found");
  }

  if (!connection.refreshToken) {
    throw new Error("Google Ads refresh token not found");
  }

  if (!customerId) {
    throw new Error("Google Ads customer ID is required");
  }

  if (!name) {
    throw new Error("Campaign name is required");
  }

  if (!budgetAmount) {
    throw new Error("Budget amount is required");
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

  // Campaign creation will be added after the request structure is tested.
  return {
    success: true,
    nexionUserId,
    customerId,
    name,
    budgetAmount,
    status,
    message: "Campaign creation request validated",
  };
};

module.exports = {
  createCampaign,
};