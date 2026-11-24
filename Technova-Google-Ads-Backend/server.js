const path = require("path");
const dotenv = require("dotenv");

const backendEnv = dotenv.config({ path: path.join(__dirname, ".env") });
if (backendEnv.parsed?.JWT_SECRET) process.env.JWT_SECRET = backendEnv.parsed.JWT_SECRET;

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
const googleAdsLeadRoutes = require("./route/googleAdsLeadRoutes");
const { ingestGoogleLead } = require("./services/googleAdsLeadService");
const { authenticateNexion, authorizeGoogleAdsAccount } = require("./middleware/nexionAuth");
const { redirectClientOAuthInvitation, completeClientOAuth } = require("./controller/googleAdsAuthController");


const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://guise-oblivion-bobsled.ngrok-free.dev"
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"]
}));

app.options(/.*/, cors({
  origin: allowedOrigins,
  credentials: true
}));
const parseJson = express.json();
const parseCampaignJson = express.json({ limit: "36mb" });
const isCampaignSubmission = (req) =>
  req.method === "POST" && /^\/api\/google-ads\/campaigns\/?$/i.test(req.baseUrl + req.path);
app.use((req, res, next) => isCampaignSubmission(req) ? next() : parseJson(req, res, next));
app.get("/api/google-ads/client-connect/:state", redirectClientOAuthInvitation);
// Client invitation completion uses a short-lived, single-use server credential;
// it is intentionally separate from the NEXION-authenticated API routes.
if (typeof completeClientOAuth === "function") app.post("/api/google-ads/client-completion", completeClientOAuth);
// Google Ads lead-form webhooks authenticate with the per-form google_key in
// the payload, not with a NEXION bearer token. Keep this endpoint outside the
// NEXION-authenticated API routes and never echo the key back to callers.
app.post("/api/google-ads/webhooks/leads", async (req, res) => {
  try { await ingestGoogleLead(req.body || {}); return res.status(200).json({}); }
  catch (error) { return res.status(error.status && error.status < 500 ? error.status : 500).json({ message: error.message }); }
});
app.use("/api/google-ads", authenticateNexion, (req, res, next) => {
  if (!isCampaignSubmission(req)) return next();
  return parseCampaignJson(req, res, (error) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ success: false, message: "Campaign images must total 24 MB or less." });
    }
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ success: false, message: "Invalid campaign request body." });
    }
    return next(error);
  });
}, authorizeGoogleAdsAccount);


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
app.use("/api/google-ads", googleAdsLeadRoutes);

if (require.main === module) {
  const port = process.env.PORT || 8000;
  const server = app.listen(port, () => {
    console.log(`Nexion Google Ads Backend running on port ${port}`);
  });

  // Keep the normal foreground Node process in charge of its own listener.
  // Ctrl+C (or a deployment stop) closes the listener before exiting.
  const shutdown = (signal) => {
    console.log(`${signal} received; closing Nexion Google Ads Backend`);
    server.close((error) => {
      if (error) {
        console.error("Nexion Google Ads Backend shutdown failed", error.message);
        process.exitCode = 1;
      }
      process.exit();
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

module.exports = app;
