const {
  getCampaigns,
} = require("../services/googleAdsCampaignService");
const { getCampaignDashboard } = require("../services/googleAdsDashboardService");

const isoDate = (date) => date.toISOString().slice(0, 10);
const shiftDate = (date, days) => { const result = new Date(`${date}T00:00:00Z`); result.setUTCDate(result.getUTCDate() + days); return isoDate(result); };
const monthStart = (date) => `${date.slice(0, 8)}01`;
const previousOptions = ({ dateRange, startDate, endDate }) => {
  if (dateRange === "custom") {
    const days = Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1;
    return { dateRange: "custom", startDate: shiftDate(startDate, -days), endDate: shiftDate(startDate, -1) };
  }
  const today = isoDate(new Date());
  const lengths = { today: 1, last_7_days: 7, last_14_days: 14, last_30_days: 30 };
  if (lengths[dateRange]) {
    const end = shiftDate(today, -(dateRange === "today" ? 1 : 8));
    return { dateRange: "custom", startDate: shiftDate(end, -lengths[dateRange] + 1), endDate: end };
  }
  if (dateRange === "last_month") {
    const currentMonth = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    const end = shiftDate(isoDate(currentMonth), -1);
    const start = isoDate(new Date(`${end.slice(0, 7)}-01T00:00:00Z`));
    const previousEnd = shiftDate(start, -1);
    return { dateRange: "custom", startDate: isoDate(new Date(`${previousEnd.slice(0, 7)}-01T00:00:00Z`)), endDate: previousEnd };
  }
  if (dateRange === "this_month") {
    const start = monthStart(today);
    const previousEnd = shiftDate(start, -1);
    return { dateRange: "custom", startDate: isoDate(new Date(`${previousEnd.slice(0, 7)}-01T00:00:00Z`)), endDate: previousEnd };
  }
  return { dateRange: "custom", startDate: shiftDate(today, -14), endDate: shiftDate(today, -8) };
};

const getCampaignList = async (req, res) => {
  try {
    const connectionId = req.query.connectionId;
    const customerId = req.query.customerId;

    const { dateRange, startDate, endDate, includePrevious } = req.query;
    const reportingRequested = dateRange !== undefined || startDate !== undefined || endDate !== undefined;
    const reportOptions = { dateRange, startDate, endDate };
    const report = reportingRequested
      ? await getCampaignDashboard(connectionId, customerId, reportOptions)
      : { campaigns: await getCampaigns(connectionId, customerId) };

    const comparison = reportingRequested && includePrevious === "true"
      ? await getCampaignDashboard(connectionId, customerId, previousOptions(reportOptions))
      : null;

    res.json({
      success: true,
      message: "Google Ads campaigns fetched successfully",
      connectionId,
      customerId,
      ...report,
      ...(comparison ? { previousPeriod: comparison } : {}),
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to fetch Google Ads campaigns",
      error: error.category || "Google Ads campaign request failed",
      ...(error.diagnosticId ? { diagnosticId: error.diagnosticId } : {}),
    });
  }
};

const getOverview = async (req, res) => {
  try {
    const campaigns = await getCampaigns(req.query.connectionId, req.query.customerId);
    const metrics = campaigns.map((row) => row.metrics || {});
    const sum = (key) => metrics.reduce((total, item) => total + Number(item[key] || 0), 0);
    const impressions = sum("impressions");
    const clicks = sum("clicks");
    const conversions = sum("conversions");
    const costMicros = sum("cost_micros");
    const averageCpcMicros = sum("average_cpc") || (clicks ? costMicros / clicks : 0);
    return res.json({
      success: true,
      data: {
        totalSpend: costMicros / 1_000_000,
        impressions,
        clicks,
        ctr: impressions ? (clicks / impressions) * 100 : 0,
        cpc: averageCpcMicros / 1_000_000,
        conversions,
        conversionRate: clicks ? (conversions / clicks) * 100 : 0,
        costPerConversion: conversions ? (costMicros / 1_000_000) / conversions : 0,
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to fetch Google Ads overview" });
  }
};

module.exports = {
  getCampaignList,
  getOverview,
};


