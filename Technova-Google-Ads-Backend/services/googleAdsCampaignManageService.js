const { GoogleAdsApi } = require("google-ads-api");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const getCustomer = async (nexionUserId, customerId) => {
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
  nexionUserId,
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

  await getCustomer(nexionUserId, customerId);

  return {
    success: true,
    nexionUserId,
    customerId,
    campaignId,
    name,
    message: "Campaign edit request validated",
  };
};


// DELETE CAMPAIGN
const deleteCampaign = async ({
  nexionUserId,
  customerId,
  campaignId,
}) => {
  if (!campaignId) {
    throw new Error("Campaign ID is required");
  }

  await getCustomer(nexionUserId, customerId);

  return {
    success: true,
    nexionUserId,
    customerId,
    campaignId,
    message: "Campaign delete request validated",
  };
};


module.exports = {
  editCampaign,


  
  deleteCampaign,
};