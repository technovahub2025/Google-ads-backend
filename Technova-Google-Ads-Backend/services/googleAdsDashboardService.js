const { getCampaigns } = require("./googleAdsCampaignService");
const { requestGoogleAdsApi, normalizeCustomerId, decamelizeKeys } = require("./googleAdsApiClient");
const { getGoogleAdsConnection } = require("../model/GoogleAdsConnection");

const PRESETS = Object.freeze({
  today: "TODAY", last_7_days: "LAST_7_DAYS", last_14_days: "LAST_14_DAYS",
  last_30_days: "LAST_30_DAYS", this_month: "THIS_MONTH", last_month: "LAST_MONTH",
});
const invalidRange = () => Object.assign(new Error("Choose a supported date range or valid start and end dates (YYYY-MM-DD)."), { status: 400 });
const validDate = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

const dateFilter = ({ dateRange, startDate, endDate }) => {
  if (typeof dateRange !== "string") throw invalidRange();
  if (Object.hasOwn(PRESETS, dateRange) && !startDate && !endDate) return `segments.date DURING ${PRESETS[dateRange]}`;
  if (dateRange !== "custom" || !validDate(startDate) || !validDate(endDate) || startDate > endDate) throw invalidRange();
  return `segments.date BETWEEN '${startDate}' AND '${endDate}'`;
};

const emptyMetrics = () => ({ impressions: 0, clicks: 0, interactions: 0, cost_micros: 0, conversions: 0, conversions_value: 0 });
const sumMetrics = (target, metrics = {}) => {
  for (const key of Object.keys(emptyMetrics())) target[key] += Number(metrics[key] || 0);
};

const getCampaignDashboard = async (connectionId, customerId, options) => {
  // Validate before accessing credentials or sending a request. Only allowlisted
  // presets and strictly parsed dates are interpolated into the reporting query.
  const filter = dateFilter(options);
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const connection = await getGoogleAdsConnection(connectionId);
  if (!connection?.refreshToken) throw Object.assign(new Error("Google Ads connection or refresh token not found"), { status: 404 });

  // Leave the corrected campaign-list GAQL unchanged. Daily reporting has its
  // own query, while the list retains campaigns with no activity in this period.
  const campaigns = await getCampaigns(connectionId, normalizedCustomerId);
  const byCampaign = new Map();
  const byDate = new Map();
  let pageToken;
  do {
    const response = await requestGoogleAdsApi({
      operation: "campaign_dashboard_metrics", stage: "campaign_daily_query",
      endpoint: "/customers/:customerId/googleAds:search", method: "POST",
      connectionId, customerId: normalizedCustomerId, managerCustomerId: connection.managerCustomerId,
      operationKind: "read", retryPolicy: "safe",
      body: { ...(pageToken ? { pageToken } : {}), query: `
        SELECT campaign.id, segments.date,
          metrics.impressions, metrics.clicks, metrics.interactions,
          metrics.cost_micros, metrics.conversions, metrics.conversions_value
        FROM campaign
        WHERE ${filter}
        ORDER BY segments.date, campaign.id
      ` },
    });
    for (const row of decamelizeKeys(response.results || [])) {
      const id = String(row.campaign.id);
      const date = row.segments.date;
      if (!byCampaign.has(id)) byCampaign.set(id, emptyMetrics());
      if (!byDate.has(date)) byDate.set(date, emptyMetrics());
      sumMetrics(byCampaign.get(id), row.metrics);
      sumMetrics(byDate.get(date), row.metrics);
    }
    pageToken = response.nextPageToken;
  } while (pageToken);

  // A reporting error is propagated, never replaced with lifetime or sample data.
  return {
    campaigns: campaigns.map((row) => {
      const metrics = byCampaign.get(String(row.campaign.id)) || emptyMetrics();
      return { ...row, metrics: {
        ...metrics,
        ctr: metrics.impressions ? metrics.clicks / metrics.impressions : 0,
        average_cpc: metrics.clicks ? metrics.cost_micros / metrics.clicks : 0,
      } };
    }),
    timeSeries: [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, metrics]) => ({
      date, spend: metrics.cost_micros / 1_000_000, clicks: metrics.clicks,
      impressions: metrics.impressions, conversions: metrics.conversions,
      ...(metrics.conversions_value ? { conversionValue: metrics.conversions_value } : {}),
    })),
    dateRange: options.dateRange,
    ...(options.dateRange === "custom" ? { startDate: options.startDate, endDate: options.endDate } : {}),
  };
};

module.exports = { getCampaignDashboard, dateFilter };
