const crypto = require("crypto");
const { getGoogleAdsConnection } = require("../model/GoogleAdsConnection");
const { getAccessTokenForConnection } = require("./googleAdsAuthService");
const { requestGoogleAdsApi, validateGoogleAdsConfiguration, normalizeCustomerId } = require("./googleAdsApiClient");

const healthResult = (status, message, category) => ({ status, message, ...(category ? { category } : {}) });

const checkGoogleAdsHealth = async ({ connectionId, customerId } = {}) => {
  const diagnosticId = crypto.randomUUID();
  const configuration = validateGoogleAdsConfiguration();
  const checks = {
    backendConfiguration: configuration.valid
      ? healthResult("healthy", "Required Google Ads configuration is present.")
      : healthResult("unavailable", `Missing configuration: ${configuration.missing.join(", ")}.`, "developer_token_or_access_level"),
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN
      ? healthResult("configured", "Developer token is configured; live access is checked separately.")
      : healthResult("not_required", "A developer token is optional; Google Cloud project access is checked by the API request."),
    oauthToken: healthResult("not_checked", "A Google Ads connection is required to check OAuth token availability."),
    googleAdsApi: healthResult("not_checked", "Live Google Ads API access has not been checked."),
    accessibleCustomerDiscovery: healthResult("not_checked", "Customer discovery has not been checked."),
    customerAccountAccess: healthResult("not_checked", "Provide a customer ID to check account access."),
    firestoreRead: healthResult("not_checked", "A connection record has not been checked."),
    firestoreWrite: healthResult("not_checked", "Write access is not tested by this read-only health check."),
  };

  if (!connectionId) {
    return { success: true, diagnosticId, healthy: false, checks };
  }

  let connection;
  try {
    connection = await getGoogleAdsConnection(connectionId);
    checks.firestoreRead = connection
      ? healthResult("healthy", "The Google Ads connection record is readable.")
      : healthResult("unavailable", "The Google Ads connection record was not found.", "database_or_persistence");
  } catch (_) {
    checks.firestoreRead = healthResult("unavailable", "The connection database could not be read.", "database_or_persistence");
  }
  if (!connection) return { success: true, diagnosticId, healthy: false, checks };

  try {
    await getAccessTokenForConnection(connectionId);
    checks.oauthToken = healthResult("healthy", "A Google Ads access token is available.");
  } catch (error) {
    checks.oauthToken = healthResult("unavailable", error?.message || "Reconnect your Google Ads account.", error?.category || "token_refresh_or_revocation");
  }

  if (configuration.valid && checks.oauthToken.status === "healthy") {
    try {
      const result = await requestGoogleAdsApi({
        diagnosticId,
        operation: "health_accessible_customer_discovery",
        stage: "accessible_customer_discovery",
        endpoint: "/customers:listAccessibleCustomers",
        method: "GET",
        connectionId,
        readOnly: true,
      });
      checks.googleAdsApi = healthResult("healthy", "Google Ads API responded successfully.");
      checks.accessibleCustomerDiscovery = healthResult("healthy", `${(result.resourceNames || []).length} directly accessible customer account(s) found.`);
      if (customerId) {
        try {
          const normalizedCustomerId = normalizeCustomerId(customerId);
          const lookup = await requestGoogleAdsApi({
            diagnosticId,
            operation: "health_customer_account_access",
            stage: "individual_customer_account_lookup",
            endpoint: "/customers/:customerId/googleAds:search",
            method: "POST",
            customerId: normalizedCustomerId,
            managerCustomerId: connection.managerCustomerId,
            connectionId,
            operationKind: "read",
            retryPolicy: "safe",
            body: { query: "SELECT customer.id FROM customer" },
          });
          checks.customerAccountAccess = (lookup.results || []).length
            ? healthResult("healthy", "The selected Google Ads customer account is accessible.")
            : healthResult("unavailable", "The selected customer account returned no customer record.", "authorization_or_account_access");
        } catch (error) {
          checks.customerAccountAccess = healthResult("unavailable", error?.message || "The selected customer account could not be checked.", error?.category || "unexpected_internal_error");
        }
      }
    } catch (error) {
      checks.googleAdsApi = healthResult("unavailable", error?.message || "Google Ads API could not be reached.", error?.category || "unexpected_internal_error");
      checks.accessibleCustomerDiscovery = healthResult("unavailable", error?.message || "Google Ads customer discovery failed.", error?.category || "unexpected_internal_error");
    }
  } else if (!configuration.valid) {
    checks.googleAdsApi = healthResult("not_checked", "Live API access cannot be checked until configuration is complete.");
    checks.accessibleCustomerDiscovery = healthResult("not_checked", "Live API access cannot be checked until configuration is complete.");
  } else {
    checks.googleAdsApi = healthResult("not_checked", "Live API access requires a valid OAuth access token.");
    checks.accessibleCustomerDiscovery = healthResult("not_checked", "Customer discovery requires a valid OAuth access token.");
  }

  const healthy = Object.values(checks).every((check) => ["healthy", "configured", "not_checked"].includes(check.status));
  return { success: true, diagnosticId, healthy, checks };
};

module.exports = { checkGoogleAdsHealth };
