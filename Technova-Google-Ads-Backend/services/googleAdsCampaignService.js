const { requestGoogleAdsApi, normalizeCustomerId, decamelizeKeys } = require("./googleAdsApiClient");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const getCampaigns = async (connectionId, customerId) => {
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

  const normalizedCustomerId = normalizeCustomerId(customerId);
  const rows = [];
  let pageToken;
  do {
    const result = await requestGoogleAdsApi({
      operation: "campaign_list",
      stage: "campaign_query",
      endpoint: "/customers/:customerId/googleAds:search",
      method: "POST",
      customerId: normalizedCustomerId,
      managerCustomerId: connection.managerCustomerId,
      connectionId,
      operationKind: "read",
      retryPolicy: "safe",
      body: { ...(pageToken ? { pageToken } : {}), query: `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions
    FROM campaign
    ORDER BY campaign.id
  ` },
    });
    rows.push(...(result.results || []));
    pageToken = result.nextPageToken;
  } while (pageToken);

  return decamelizeKeys(rows);
};

module.exports = {
  getCampaigns,
};
