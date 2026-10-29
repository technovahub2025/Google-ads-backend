const { GoogleAdsApi } = require("google-ads-api");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const getCampaignReport = async ({
  connectionId,
  customerId,
  startDate,
  endDate,
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

  if (!startDate) {
    throw new Error("Start date is required");
  }

  if (!endDate) {
    throw new Error("End date is required");
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
    startDate,
    endDate,
    message: "Campaign report request validated",
  };
};

module.exports = {
  getCampaignReport,
};