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


// EDIT KEYWORD
const editKeyword = async ({
  nexionUserId,
  customerId,
  keywordId,
  keyword,
  matchType = "BROAD",
}) => {
  if (!keywordId) {
    throw new Error("Keyword ID is required");
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

  await getCustomer(nexionUserId, customerId);

  return {
    success: true,
    nexionUserId,
    customerId,
    keywordId,
    keyword,
    matchType,
    message: "Keyword edit request validated",
  };
};


// DELETE KEYWORD
const deleteKeyword = async ({
  nexionUserId,
  customerId,
  keywordId,
}) => {
  if (!keywordId) {
    throw new Error("Keyword ID is required");
  }

  await getCustomer(nexionUserId, customerId);

  return {
    success: true,
    nexionUserId,
    customerId,
    keywordId,
    message: "Keyword delete request validated",
  };
};


module.exports = {
  editKeyword,
  deleteKeyword,
};