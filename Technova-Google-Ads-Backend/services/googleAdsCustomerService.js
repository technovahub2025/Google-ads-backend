const crypto = require("crypto");
const { requestGoogleAdsApi, normalizeCustomerId, decamelizeKeys, API_ROOT } = require("./googleAdsApiClient");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const diagnosticLog = (diagnosticId, stage, outcome, details = {}) => {
  const event = { event: "google_ads_account_diagnostic", diagnosticId, stage, outcome, timestamp: new Date().toISOString(), ...details };
  (outcome === "failed" ? console.error : console.info)(JSON.stringify(event));
};

const runtimeRequestContext = () => {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "");
  return {
    apiVersion: API_ROOT.split("/").pop(),
    oauthClientConfigured: Boolean(clientId && process.env.GOOGLE_CLIENT_SECRET),
    ...(clientId ? { oauthClientIdFingerprint: crypto.createHash("sha256").update(clientId).digest("hex").slice(0, 12) } : {}),
    ...((process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT)
      ? { cloudProjectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT }
      : {}),
  };
};

const lookupFailureMessage = ({ error, customerId, managerCustomerId }) => {
  const status = Number(error?.status || error?.diagnostic?.httpStatus);
  const code = String(error?.diagnostic?.googleAdsErrorCode || error?.code || "").toUpperCase();
  if (/INVALID_CUSTOMER_ID|CUSTOMER_ID_INVALID|CUSTOMER_NOT_FOUND/.test(code)) {
    return `Google Ads rejected Customer ID ${customerId}. Check that this is the correct 10-digit Customer ID.`;
  }
  if (/CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION|PROJECT_NOT_ALLOWED|CLOUD_PROJECT_ACCESS_DENIED|ACCESS_LEVEL/.test(code)) {
    return "The Google Cloud project used by NEXION does not have the required Google Ads API access level for this production account. Check the project's Google Ads API access level in Google Cloud Console.";
  }
  if (status === 400) {
    return `Google Ads rejected the lookup request for Customer ID ${customerId}. Check the Customer ID and request details.`;
  }
  if (status === 403 || /PERMISSION_DENIED|USER_PERMISSION_DENIED/.test(code)) {
    return managerCustomerId
      ? `Google denied access to Customer ID ${customerId} through Manager Customer ID ${managerCustomerId}. Verify that the Google account has access, the manager ID is correct, and this customer account is linked to that manager.`
      : `The connected Google account cannot read Customer ID ${customerId}. Verify the account's access. If this customer is managed through an MCC, configure its Manager Customer ID and confirm the customer is linked to that manager.`;
  }
  return error?.message || `Google Ads customer lookup failed for Customer ID ${customerId}.`;
};

const getCustomerAccount = async ({ customerId, ...options }) => {
  const result = await requestGoogleAdsApi({
    endpoint: "/customers/:customerId/googleAds:search", method: "POST",
    operation: "individual_customer_account_lookup", stage: "individual_customer_account_lookup",
    operationKind: "read", retryPolicy: "safe", customerId, ...options,
    body: { query: `
      SELECT customer.id, customer.descriptive_name, customer.currency_code,
        customer.time_zone, customer.manager
      FROM customer
    ` },
  });
  const [account] = decamelizeKeys(result.results || []);
  const returnedCustomerId = account?.customer?.id === undefined ? undefined : normalizeCustomerId(account.customer.id);
  if (returnedCustomerId && returnedCustomerId !== normalizeCustomerId(customerId)) {
    throw Object.assign(new Error(`Google Ads returned Customer ID ${returnedCustomerId} for requested Customer ID ${customerId}. Verify the selected Customer ID.`), {
      code: "GOOGLE_ADS_CUSTOMER_ID_MISMATCH", status: 502,
    });
  }
  return account;
};

const getAccessibleCustomerAccounts = async (connectionId) => {
  const connection = await getGoogleAdsConnection(connectionId);

  if (!connection) {
    throw new Error("Google Ads connection not found");
  }

  if (!connection.refreshToken) {
    throw new Error("Google Ads refresh token not found");
  }

  return getAccessibleCustomerAccountsForToken(connection.refreshToken, {
    connectionId,
    managerCustomerId: connection.managerCustomerId,
    authSource: "firestore_connection",
    connectionCredentialVersion: connection.credentialVersion || 0,
    connectionStatus: connection.connectionStatus || (connection.connected ? "connected" : "unknown"),
  });
};

const getAccessibleCustomerAccountsForToken = async (refreshToken, { connectionId, accessToken, diagnosticId, onDiagnostic, managerCustomerId,
  authSource = connectionId ? "firestore_connection" : "provided_oauth_tokens", connectionCredentialVersion, connectionStatus } = {}) => {
  let normalizedManagerCustomerId;
  try {
    normalizedManagerCustomerId = managerCustomerId ? normalizeCustomerId(managerCustomerId) : undefined;
  } catch (error) {
    diagnosticLog(diagnosticId, "individual_customer_account_lookup", "failed", {
      reason: "invalid_manager_customer_id",
      ...(managerCustomerId ? { suppliedManagerCustomerId: String(managerCustomerId).slice(0, 32) } : {}),
    });
    throw Object.assign(new Error("The configured Manager Customer ID is invalid. Enter the correct 10-digit MCC Customer ID."), {
      status: 400, code: "INVALID_MANAGER_CUSTOMER_ID", cause: error,
    });
  }
  // This REST endpoint discovers directly accessible customers without a
  // preconfigured customer ID.
  const accessibleCustomers = await requestGoogleAdsApi({
    operation: "accessible_customer_discovery", endpoint: "/customers:listAccessibleCustomers", method: "GET",
    stage: "accessible_customer_discovery", connectionId, refreshToken, accessToken, diagnosticId, retryPolicy: "safe",
    onDiagnostic: (_event, error) => onDiagnostic?.("accessible_customer_discovery", error),
  });
  const customerResourceNames = accessibleCustomers.resourceNames || [];
  const discoveredCustomerIds = customerResourceNames.map((resourceName) => normalizeCustomerId(resourceName.split("/").pop()));
  diagnosticLog(diagnosticId, "accessible_customer_discovery", "succeeded", {
    ...runtimeRequestContext(),
    authSource,
    accessTokenProvided: Boolean(accessToken),
    refreshTokenProvided: Boolean(refreshToken),
    ...(connectionId ? { connectionId, connectionCredentialVersion, connectionStatus } : {}),
    customerIds: discoveredCustomerIds,
    ...(normalizedManagerCustomerId ? { configuredManagerCustomerId: normalizedManagerCustomerId } : {}),
  });

  const customerAccounts = await Promise.all(
    customerResourceNames.map(async (resourceName, index) => {
      const customerId = normalizeCustomerId(resourceName.split("/").pop());
      diagnosticLog(diagnosticId, "individual_customer_account_lookup", "started", {
        ...runtimeRequestContext(),
        authSource,
        ...(connectionId ? { connectionId, connectionCredentialVersion, connectionStatus } : {}),
        customerId,
        ...(normalizedManagerCustomerId ? { managerCustomerId: normalizedManagerCustomerId } : {}),
        loginCustomerIdHeaderSent: Boolean(normalizedManagerCustomerId && normalizedManagerCustomerId !== customerId),
        customerIdWasDiscovered: discoveredCustomerIds[index] === customerId,
      });
      try {
        const account = await getCustomerAccount({
          customerId, managerCustomerId: normalizedManagerCustomerId, connectionId, refreshToken, accessToken, diagnosticId,
          onDiagnostic: (_event, error) => onDiagnostic?.("individual_customer_account_lookup", error),
        });
        diagnosticLog(diagnosticId, "individual_customer_account_lookup", "succeeded", {
          customerId,
          ...(normalizedManagerCustomerId ? { managerCustomerId: normalizedManagerCustomerId } : {}),
          ...(typeof account?.customer?.manager === "boolean" ? { isManagerAccount: account.customer.manager } : {}),
        });
        return account;
      } catch (error) {
        const message = lookupFailureMessage({ error, customerId, managerCustomerId: normalizedManagerCustomerId });
        diagnosticLog(diagnosticId, "individual_customer_account_lookup", "failed", {
          ...runtimeRequestContext(),
          authSource,
          ...(connectionId ? { connectionId, connectionCredentialVersion, connectionStatus } : {}),
          customerId,
          ...(normalizedManagerCustomerId ? { managerCustomerId: normalizedManagerCustomerId } : {}),
          loginCustomerIdHeaderSent: Boolean(normalizedManagerCustomerId && normalizedManagerCustomerId !== customerId),
          customerIdWasDiscovered: discoveredCustomerIds[index] === customerId,
          ...(error?.status ? { httpStatus: error.status } : error?.diagnostic?.httpStatus ? { httpStatus: error.diagnostic.httpStatus } : {}),
          ...(error?.category || error?.diagnostic?.category ? { category: error.category || error.diagnostic.category } : {}),
          ...(error?.diagnostic?.googleAdsErrorCode ? { googleAdsErrorCode: error.diagnostic.googleAdsErrorCode } : {}),
          ...(error?.diagnostic?.googleAdsRequestId ? { googleAdsRequestId: error.diagnostic.googleAdsRequestId } : {}),
        });
        throw Object.assign(new Error(message), {
          ...(error?.status ? { status: error.status } : error?.diagnostic?.httpStatus ? { status: error.diagnostic.httpStatus } : {}),
          ...(error?.category || error?.diagnostic?.category ? { category: error.category || error.diagnostic.category } : {}),
          ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}),
          ...(error?.diagnosticId ? { diagnosticId: error.diagnosticId } : {}),
          ...(error?.code ? { code: error.code } : {}),
        });
      }
    }),
  );

  return customerAccounts;
};

module.exports = {
  getCustomerAccount,
  getAccessibleCustomerAccounts,
  getAccessibleCustomerAccountsForToken,
};
