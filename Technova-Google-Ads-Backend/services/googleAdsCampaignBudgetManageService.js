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


// EDIT CAMPAIGN BUDGET
const editCampaignBudget = async ({
  nexionUserId,
  customerId,
  budgetId,
  budgetAmount,
}) => {
  if (!budgetId) {
    throw new Error("Budget ID is required");
  }

  if (!budgetAmount) {
    throw new Error("Budget amount is required");
  }

  await getCustomer(nexionUserId, customerId);

  return {
    success: true,
    nexionUserId,
    customerId,
    budgetId,
    budgetAmount,
    message: "Campaign budget edit request validated",
  };
};


// DELETE CAMPAIGN BUDGET
const deleteCampaignBudget = async ({
  nexionUserId,
  customerId,
  budgetId,
}) => {
  if (!budgetId) {
    throw new Error("Budget ID is required");
  }

  await getCustomer(nexionUserId, customerId);

  return {
    success: true,
    nexionUserId,
    customerId,
    budgetId,
    message: "Campaign budget delete request validated",
  };
};


module.exports = {
  editCampaignBudget,
  deleteCampaignBudget,
};