const { GoogleAdsApi } = require("google-ads-api");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const getCustomer = async (connectionId, customerId) => {
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

  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  });

  return client.Customer({
    customer_id: customerId,
    refresh_token: connection.refreshToken,
  });
};


// EDIT CAMPAIGN
const editCampaign = async ({
  connectionId,
  customerId,
  campaignId,
  name,
}) => {
  if (!campaignId) {
    throw new Error("Campaign ID is required");
  }

  if (!name) {
    throw new Error("Campaign name is required");
  }

  await getCustomer(connectionId, customerId);

  return {
    success: true,
    connectionId,
    customerId,
    campaignId,
    name,
    message: "Campaign edit request validated",
  };
};


// DELETE CAMPAIGN
const deleteCampaign = async ({
  connectionId,
  customerId,
  campaignId,
}) => {
  if (!campaignId) {
    throw new Error("Campaign ID is required");
  }

  await getCustomer(connectionId, customerId);

  return {
    success: true,
    connectionId,
    customerId,
    campaignId,
    message: "Campaign delete request validated",
  };
};


module.exports = {
  editCampaign,


  
  deleteCampaign,
};