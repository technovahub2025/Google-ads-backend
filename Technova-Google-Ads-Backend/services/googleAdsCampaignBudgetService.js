const { GoogleAdsApi } = require("google-ads-api");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const createCampaignBudget = async ({
  nexionUserId,
  customerId,
  budgetAmount,
  name = "Nexion Campaign Budget",
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

  // Convert normal currency amount to Google Ads micros.
  const amountMicros = Math.round(
    Number(budgetAmount) * 1000000
  );

  if (!Number.isFinite(amountMicros) || amountMicros <= 0) {
    throw new Error("Budget amount must be a valid positive number");
  }

  const budget = {
    name,
    delivery_method: "STANDARD",
    amount_micros: amountMicros,
  };

  const operation = {
    create: budget,
  };

  const response =
    await customer.campaignBudgets.create(operation);

  return {
    success: true,
    nexionUserId,
    customerId,
    budgetAmount,
    amountMicros,
    resourceName: response.resource_name,
    message: "Campaign budget created successfully",
  };
};

module.exports = {
  createCampaignBudget,
};