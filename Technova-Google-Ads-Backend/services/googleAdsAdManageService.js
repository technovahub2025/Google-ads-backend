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


// EDIT AD
const editAd = async ({
  nexionUserId,
  customerId,
  adId,
  headlines,
  descriptions,
  finalUrl,
}) => {
  if (!adId) {
    throw new Error("Ad ID is required");
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

  await getCustomer(nexionUserId, customerId);

  return {
    success: true,
    nexionUserId,
    customerId,
    adId,
    headlines,
    descriptions,
    finalUrl,
    message: "Ad edit request validated",
  };
};


// DELETE AD
const deleteAd = async ({
  nexionUserId,
  customerId,
  adId,
}) => {
  if (!adId) {
    throw new Error("Ad ID is required");
  }

  await getCustomer(nexionUserId, customerId);

  return {
    success: true,
    nexionUserId,
    customerId,
    adId,
    message: "Ad delete request validated",
  };
};


module.exports = {
  editAd,
  deleteAd,
};