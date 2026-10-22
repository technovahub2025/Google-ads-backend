require("dotenv").config();

const express = require("express");
const cors = require("cors");

require("./config/firebase");

const googleAdsAuthRoutes = require("./route/googleAdsAuthRoutes");
const googleAdsConnectionRoutes = require("./route/googleAdsConnectionRoutes");
const googleAdsCustomerRoutes = require("./route/googleAdsCustomerRoutes");
const googleAdsCampaignRoutes = require("./route/googleAdsCampaignRoutes");
const googleAdsCampaignCreateRoutes = require("./route/googleAdsCampaignCreateRoutes");
const googleAdsCampaignBudgetRoutes = require("./route/googleAdsCampaignBudgetRoutes");
const googleAdsAdGroupRoutes = require("./route/googleAdsAdGroupRoutes");
const googleAdsKeywordRoutes = require("./route/googleAdsKeywordRoutes");
const googleAdsAdRoutes = require("./route/googleAdsAdRoutes");
const googleAdsCampaignStatusRoutes = require("./route/googleAdsCampaignStatusRoutes");
const googleAdsReportRoutes = require("./route/googleAdsReportRoutes");
const googleAdsCampaignManageRoutes = require("./route/googleAdsCampaignManageRoutes");
const googleAdsCampaignBudgetManageRoutes = require("./route/googleAdsCampaignBudgetManageRoutes");
const googleAdsAdGroupManageRoutes = require("./route/googleAdsAdGroupManageRoutes");
const googleAdsKeywordManageRoutes = require("./route/googleAdsKeywordManageRoutes");
const googleAdsAdManageRoutes = require("./route/googleAdsAdManageRoutes");


const app = express();

app.use(cors());
app.use(express.json());


app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Nexion Google Ads Backend is running",
  });
});

app.use("/api/google-ads", googleAdsAuthRoutes);
app.use("/api/google-ads", googleAdsConnectionRoutes);
app.use("/api/google-ads", googleAdsAdGroupRoutes);
app.use("/api/google-ads", googleAdsCustomerRoutes);
app.use("/api/google-ads", googleAdsAdRoutes);
app.use("/api/google-ads", googleAdsCampaignRoutes);
app.use("/api/google-ads", googleAdsCampaignCreateRoutes);
app.use("/api/google-ads", googleAdsCampaignBudgetRoutes);
app.use("/api/google-ads", googleAdsKeywordRoutes);
app.use("/api/google-ads", googleAdsCampaignStatusRoutes);
app.use("/api/google-ads", googleAdsReportRoutes);
app.use("/api/google-ads", googleAdsCampaignManageRoutes);
app.use("/api/google-ads",googleAdsCampaignBudgetManageRoutes);
app.use("/api/google-ads",googleAdsAdGroupManageRoutes);
app.use("/api/google-ads", googleAdsKeywordManageRoutes);
app.use("/api/google-ads", googleAdsAdManageRoutes);

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`Nexion Google Ads Backend running on port ${PORT}`);
});
