const { createGoogleOAuthClient } = require("../config/googleOAuth");
const { getGoogleAdsConnection, updateGoogleAdsCredentials } = require("../model/GoogleAdsConnection");

const crypto = require("crypto");
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const refreshes = new Map();
const reconnectError = () => Object.assign(new Error("Google Ads Reconnect Required"), { code: "RECONNECT_REQUIRED", status: 409 });
const invalidRefresh = (error) => ["invalid_grant", "invalid_token"].includes(error?.response?.data?.error);
const authenticationFailure = (error) => invalidRefresh(error) || error?.response?.status === 401 || error?.code === 16 ||
  error?.errors?.some((item) => ["OAUTH_TOKEN_REVOKED", "OAUTH_TOKEN_INVALID", "OAUTH_TOKEN_EXPIRED"].includes(item.error_code?.authentication_error || item.errorCode?.authenticationError));
const getGoogleAdsDiagnostic = (error) => {
  if (error?.diagnostic && typeof error.diagnostic === "object") return error.diagnostic;
  const apiError = error?.errors?.[0] || error?.response?.data?.error?.details?.[0] || error?.response?.data?.error || {};
  const headers = error?.response?.headers;
  const requestId = error?.request_id || error?.requestId || headers?.get?.("request-id") || headers?.get?.("google-ads-request-id") ||
    headers?.["request-id"] || headers?.["google-ads-request-id"];
  const rawErrorCode = apiError.error_code || apiError.errorCode || error?.code;
  const errorCode = typeof rawErrorCode === "string" || typeof rawErrorCode === "number"
    ? String(rawErrorCode)
    : rawErrorCode && typeof rawErrorCode === "object"
      ? Object.entries(rawErrorCode).filter(([, value]) => typeof value === "string" || typeof value === "number").map(([key, value]) => `${key}.${value}`).join(", ")
      : undefined;
  const status = Number(error?.response?.status || error?.status);
  const message = apiError.message || error?.message;
  return {
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { httpStatus: status } : {}),
    ...(errorCode ? { errorCode: String(errorCode).slice(0, 200) } : {}),
    ...(typeof message === "string" ? { message: message.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").replace(/["']?\b(access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|developer[_ -]?token|authorization[_ -]?code|code|state|invitation[_ -]?token|password)["']?(\s*[:=]\s*)["']?[^\s,"'}]+["']?/gi, "$1$2[REDACTED]").replace(/https?:\/\/\S+/gi, "[URL]").slice(0, 500) } : {}),
    ...(typeof requestId === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(requestId) ? { requestId } : {}),
  };
};
const publicGoogleAdsMessage = (category, diagnosticId) => ({
  authentication: "Reconnect your Google Ads account.",
  authorization_or_account_access: "Your Google account does not have access to this Ads account.",
  developer_token_or_access_level: "Google Ads API access is unavailable. Check the Google Cloud project's API access level and OAuth configuration.",
  invalid_request: "The Google Ads request is invalid. Check the selected account and request values.",
  rate_limit_or_quota: "Google Ads request limit reached. Please retry shortly.",
  temporary_google_api_failure: "Google Ads is temporarily unavailable. Please retry shortly.",
  network_or_timeout: "Google Ads could not be reached. Please retry shortly.",
  token_refresh_or_revocation: "Reconnect your Google Ads account.",
}[category] || `Something went wrong. Share diagnostic ID ${diagnosticId} with support.`);
const safeApiError = (originalError, context = {}) => Object.assign(new Error(publicGoogleAdsMessage(context.category, context.diagnosticId)), {
  status: 502,
  ...(originalError ? { diagnostic: {
    ...getGoogleAdsDiagnostic(originalError),
    ...(context.diagnosticId ? { diagnosticId: context.diagnosticId } : {}),
    ...(context.operationName ? { operation: context.operationName } : {}),
    stage: "google_ads_sdk_request",
    outcome: "failed",
    category: context.category || "unexpected_internal_error",
    retryCount: context.retryCount || 0,
    timestamp: new Date().toISOString(),
  } } : {}),
  ...context,
});
const temporaryFailure = (error) => {
  const status = Number(error?.response?.status || error?.status);
  return [408, 429, 500, 502, 503, 504].includes(status) || [4, 8, 14].includes(error?.code) || error?.name === "TimeoutError" ||
    ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"].includes(error?.code || error?.cause?.code);
};

// Replay only refreshes and reads. A mutation may have succeeded before a network failure.
const withTemporaryRetry = async (operation, { onRetry } = {}) => {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 2 || !temporaryFailure(error) || invalidRefresh(error)) throw error;
      const retryAfterValue = error?.response?.headers?.get?.("retry-after") || error?.response?.headers?.["retry-after"];
      const retryAfterSeconds = Number(retryAfterValue);
      const retryAfterDate = Date.parse(retryAfterValue || "");
      const retryAfterMs = Number.isFinite(retryAfterSeconds) ? Math.max(0, retryAfterSeconds * 1000) : Number.isFinite(retryAfterDate) ? Math.max(0, retryAfterDate - Date.now()) : 0;
      const delay = Math.min(5000, Math.max(250 * 2 ** attempt + Math.random() * 150, retryAfterMs));
      onRetry?.({ retryCount: attempt + 1, delay, error });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};
const expiryMillis = (value) => value?.toMillis?.() || value?.toDate?.().getTime() || (value ? new Date(value).getTime() : 0);

const getAccessTokenForConnection = async (connectionId, { forceRefresh = false } = {}) => {
  if (refreshes.has(connectionId)) return refreshes.get(connectionId);
  const refresh = (async () => {
    const connection = await getGoogleAdsConnection(connectionId);
    if (!connection) throw new Error("Google Ads connection not found");
    if (connection.connectionStatus === "reconnect_required") throw reconnectError();
    if (!connection.refreshToken) {
      await updateGoogleAdsCredentials(connectionId, connection, { connected: false, connectionStatus: "reconnect_required", accessToken: null, accessTokenExpiresAt: null });
      throw reconnectError();
    }
    if (!forceRefresh && connection.accessToken && expiryMillis(connection.accessTokenExpiresAt) > Date.now() + REFRESH_MARGIN_MS) return connection.accessToken;
    // Never share mutable OAuth credentials between connections.
    const oauth = createGoogleOAuthClient();
    oauth.setCredentials({ refresh_token: connection.refreshToken });
    try {
      const { credentials } = await withTemporaryRetry(() => oauth.refreshAccessToken());
      if (!credentials?.access_token || !Number.isFinite(credentials.expiry_date)) throw new Error("Invalid refresh response");
      const saved = await updateGoogleAdsCredentials(connectionId, connection, {
        accessToken: credentials.access_token, accessTokenExpiresAt: new Date(credentials.expiry_date),
        ...(credentials.refresh_token && credentials.refresh_token !== connection.refreshToken ? { refreshToken: credentials.refresh_token, credentialVersion: (connection.credentialVersion || 0) + 1 } : {}),
        connected: true, connectionStatus: "connected",
      });
      if (!saved) {
        const current = await getGoogleAdsConnection(connectionId);
        if (current?.accessToken && expiryMillis(current.accessTokenExpiresAt) > Date.now()) return current.accessToken;
        throw new Error("Credentials changed during refresh; retry the request");
      }
      return credentials.access_token;
    } catch (error) {
      if (invalidRefresh(error)) {
        const saved = await updateGoogleAdsCredentials(connectionId, connection, { connected: false, connectionStatus: "reconnect_required", accessToken: null, accessTokenExpiresAt: null });
        if (saved) throw reconnectError();
        // A concurrent callback may have replaced the rejected credentials.
        const current = await getGoogleAdsConnection(connectionId);
        if (current?.accessToken && expiryMillis(current.accessTokenExpiresAt) > Date.now()) return current.accessToken;
      }
      // OAuth errors may contain secrets in request bodies; return a safe error.
      throw Object.assign(new Error("Google Ads token refresh temporarily unavailable; retry shortly"), { status: 503, category: "token_refresh_or_revocation" });
    }
  })();
  refreshes.set(connectionId, refresh);
  try { return await refresh; }
  finally { if (refreshes.get(connectionId) === refresh) refreshes.delete(connectionId); }
};

const emitDiagnostic = (event, failed = false) => {
  (failed ? console.error : console.info)(JSON.stringify(event));
};
const runGoogleAdsRequest = async (connectionId, operation, { readOnly = true, diagnosticId = crypto.randomUUID(), operationName = "google_ads_sdk_operation" } = {}) => {
  let retryCount = 0;
  const event = (stage, outcome, details = {}) => ({ event: "google_ads_diagnostic", diagnosticId, operation: operationName, stage, outcome, retryCount, timestamp: new Date().toISOString(), ...details });
  let requestError;
  try {
    await getAccessTokenForConnection(connectionId);
    const result = await (readOnly ? withTemporaryRetry(operation, { onRetry: ({ retryCount: retryNumber, delay, error }) => {
      retryCount = Math.max(retryCount, retryNumber);
      emitDiagnostic(event("google_ads_sdk_request", "retrying", { category: "temporary_google_api_failure", retryCount, retryDelayMs: Math.round(delay), ...getGoogleAdsDiagnostic(error) }));
    } }) : operation());
    emitDiagnostic(event("google_ads_sdk_request", "succeeded"));
    return result;
  } catch (error) {
    requestError = error;
  }

  try {
    // A failed access token may be refreshable. Retry a read only after refreshing once.
    if (authenticationFailure(requestError)) {
      emitDiagnostic(event("token_refresh", "retrying", { category: "authentication" }));
      await getAccessTokenForConnection(connectionId, { forceRefresh: true });
      if (readOnly) {
        const result = await withTemporaryRetry(operation, { onRetry: ({ retryCount: retryNumber, delay, error }) => {
          retryCount = Math.max(retryCount, retryNumber);
          emitDiagnostic(event("google_ads_sdk_request", "retrying", { category: "temporary_google_api_failure", retryCount, retryDelayMs: Math.round(delay), ...getGoogleAdsDiagnostic(error) }));
        } });
        emitDiagnostic(event("google_ads_sdk_request", "succeeded", { afterTokenRefresh: true }));
        return result;
      }
    }
  } catch (retryError) {
    requestError = retryError;
  }

  const error = requestError;
  const status = Number(error?.response?.status || error?.status);
  const errorDiagnostic = getGoogleAdsDiagnostic(error);
  const codeText = `${error?.code || ""} ${errorDiagnostic.errorCode || ""}`.toUpperCase();
  const errorText = String(error?.message || errorDiagnostic.message || "");
  const category = error?.code === "RECONNECT_REQUIRED" ? "token_refresh_or_revocation"
    : error.category || (/DEVELOPER_TOKEN|ACCESS_LEVEL|PROJECT_ACCESS|CLOUD_PROJECT/.test(codeText) || /cloud project access|api access level/i.test(errorText) ? "developer_token_or_access_level"
      : /INVALID_ARGUMENT|INVALID_CUSTOMER|VALIDATION/.test(codeText) || status === 400 ? "invalid_request"
        : status === 401 ? "authentication" : status === 403 || /PERMISSION|USER_PERMISSION_DENIED/.test(codeText) ? "authorization_or_account_access"
          : status === 429 ? "rate_limit_or_quota" : [408, 500, 502, 503, 504].includes(status) ? "temporary_google_api_failure"
            : /ECONN|ETIMEDOUT|NETWORK|TIMEOUT/i.test(`${codeText} ${errorText}`) ? "network_or_timeout" : "unexpected_internal_error");
  emitDiagnostic(event("google_ads_sdk_request", "failed", { category, ...getGoogleAdsDiagnostic(error) }), true);
  // SDK errors can embed Authorization headers. Only sanitized diagnostic fields survive.
  throw safeApiError(error, { diagnosticId, category, operationName, retryCount });
};

module.exports = { getAccessTokenForConnection, runGoogleAdsRequest, withTemporaryRetry };
