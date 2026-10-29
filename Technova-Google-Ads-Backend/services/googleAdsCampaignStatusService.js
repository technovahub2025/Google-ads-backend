const { GoogleAdsApi } = require("google-ads-api");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const updateCampaignStatus = async ({
  connectionId,
  customerId,
  campaignId,
  status,
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

  if (!campaignId) {
    throw new Error("Campaign ID is required");
  }

  const allowedStatuses = [
    "ENABLED",
    "PAUSED",
  ];

  if (!allowedStatuses.includes(status)) {
    throw new Error(
      "Status must be ENABLED or PAUSED"
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
    campaignId,
    status,
    message: "Campaign status request validated",
  };
};

module.exports = {
  updateCampaignStatus,
};
