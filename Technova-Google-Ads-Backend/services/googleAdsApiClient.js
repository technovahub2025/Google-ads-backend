const crypto = require("crypto");
const { googleAdsVersion, errors } = require("google-ads-api");
const { createGoogleOAuthClient } = require("../config/googleOAuth");
const { getAccessTokenForConnection } = require("./googleAdsAuthService");

const API_ROOT = `https://googleads.googleapis.com/${googleAdsVersion}`;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"]);

const normalizeCustomerId = (value) => {
  const customerId = String(value || "").replace(/-/g, "");
  if (!/^\d{10}$/.test(customerId)) {
    throw Object.assign(new Error("Google Ads customer ID must contain exactly 10 digits"), {
      category: "invalid_request", code: "INVALID_CUSTOMER_ID", status: 400,
    });
  }
  return customerId;
};

const decamelizeKeys = (value) => {
  if (Array.isArray(value)) return value.map(decamelizeKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), decamelizeKeys(nested)]));
};

const redact = (value, sensitiveValues = []) => {
  let text = String(value || "");
  for (const secret of [...sensitiveValues, ...["GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN", "JWT_SECRET"].map((key) => process.env[key])]) {
    if (typeof secret === "string" && secret.length >= 4) text = text.split(secret).join("[REDACTED]");
  }
  return text
  .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
  .replace(/["']?\b(access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|developer[_ -]?token|authorization[_ -]?code|code|state|invitation[_ -]?token|password)["']?(\s*[:=]\s*)["']?[^\s,"'}]+["']?/gi, "$1$2[REDACTED]")
  .replace(/https?:\/\/\S+/gi, "[URL]")
  .slice(0, 500);
};

const classify = ({ status, code, message }) => {
  const normalized = String(code && typeof code === "object" ? Object.entries(code).map(([key, value]) => `${key}.${value}`).join(",") : code || "").toUpperCase();
  const text = String(message || "").toLowerCase();
  if (/INSUFFICIENT_SCOPE|OAUTH_SCOPE/.test(normalized)) return "authorization_or_account_access";
  if ([401].includes(status) || /OAUTH|TOKEN_INVALID|TOKEN_EXPIRED|UNAUTHENTICATED/.test(normalized)) return "authentication";
  if (/DEVELOPER_TOKEN|CUSTOMER_NOT_ENABLED|ACCESS_LEVEL|PROJECT_ACCESS|CLOUD_PROJECT/.test(normalized) || /developer token|api access level|cloud project access/.test(text)) return "developer_token_or_access_level";
  if ([403].includes(status) || /PERMISSION|USER_PERMISSION_DENIED|CUSTOMER_NOT_FOUND/.test(normalized)) return "authorization_or_account_access";
  if ([429].includes(status) || /QUOTA|RATE_LIMIT/.test(normalized)) return "rate_limit_or_quota";
  if ([408, 500, 502, 503, 504].includes(status)) return "temporary_google_api_failure";
  if (status >= 400 && status < 500) return "invalid_request";
  if (RETRYABLE_NETWORK_CODES.has(normalized) || /timeout|network|fetch failed/i.test(text)) return "network_or_timeout";
  return "unexpected_internal_error";
};

const responseHeader = (headers, name) => headers?.get?.(name) || headers?.[name] || headers?.[name.toLowerCase()];

const extractGoogleAdsError = (payload) => {
  const apiError = payload?.error || {};
  const failures = (Array.isArray(apiError.details) ? apiError.details : []).flatMap((detail) => {
    // REST expands Any into JSON; older responses may contain encoded protobuf.
    if (Array.isArray(detail?.errors)) return [detail];
    try {
      if (detail?.value && errors?.GoogleAdsFailure) return [errors.GoogleAdsFailure.decode(Buffer.from(detail.value, "base64"))];
    } catch (_) { /* Preserve the top-level error when a detail cannot be decoded. */ }
    return [];
  });
  const items = failures.flatMap((failure) => failure.errors || []);
  const item = items[0];
  return {
    code: item?.errorCode || item?.error_code || apiError.status || apiError.code,
    apiStatus: apiError.status,
    message: item?.message || apiError.message || "Google Ads API request failed",
    requestId: failures.map((failure) => failure.requestId || failure.request_id).find(Boolean),
    details: items.slice(0, 50).map((error) => ({
      errorCode: error.errorCode || error.error_code,
      message: error.message,
      ...(error.trigger ? { trigger: error.trigger } : {}),
      ...(error.location ? { location: error.location } : {}),
      ...(error.details ? { details: error.details } : {}),
    })),
  };
};

// Bound and sanitize structured failure data. Never serialize response/request
// objects, headers, OAuth credentials, or arbitrary Google response properties.
const sanitizeDetails = (value, depth = 0, sensitiveValues = []) => {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return redact(value, sensitiveValues);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeDetails(item, depth + 1, sensitiveValues));
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [
    redact(key), /^(?:access_?token|refresh_?token|developer_?token|client_?secret|authorization|password|credentials?)$/i.test(key) ? "[REDACTED]" : sanitizeDetails(item, depth + 1, sensitiveValues),
  ]));
};

const queryStructure = (body) => {
  if (typeof body?.query !== "string") return {};
  // Keep field names and operators, but never log literal filter values.
  const shape = body.query.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "?").replace(/\b\d+(?:\.\d+)?\b/g, "?").replace(/\s+/g, " ").trim();
  return {
    gaql: redact(shape),
    requestParameters: Object.keys(body).filter((key) => ["query", "pageToken", "pageSize", "validateOnly", "searchSettings", "returnTotalResultsCount"].includes(key)),
  };
};

const publicMessage = (category) => ({
  authentication: "Reconnect your Google Ads account.",
  authorization_or_account_access: "Your Google account does not have access to this Ads account.",
  developer_token_or_access_level: "Google Ads API access is unavailable. Check the Google Cloud project's API access level and OAuth configuration.",
  invalid_request: "The Google Ads request is invalid. Check the selected account and request values.",
  rate_limit_or_quota: "Google Ads request limit reached. Please retry shortly.",
  temporary_google_api_failure: "Google Ads is temporarily unavailable. Please retry shortly.",
  network_or_timeout: "Google Ads could not be reached. Please retry shortly.",
  token_refresh_or_revocation: "Reconnect your Google Ads account.",
  database_or_persistence: "The Google Ads connection could not be saved.",
  unexpected_internal_error: "Something went wrong. Share the diagnostic ID with support.",
}[category] || "Something went wrong. Share the diagnostic ID with support.");

const validateGoogleAdsConfiguration = () => {
  const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]
    .filter((key) => !String(process.env[key] || "").trim());
  if (process.env.GOOGLE_REDIRECT_URI) {
    try {
      const redirect = new URL(process.env.GOOGLE_REDIRECT_URI);
      if (!/^https?:$/.test(redirect.protocol) || !redirect.pathname.endsWith("/auth/callback")) missing.push("GOOGLE_REDIRECT_URI (invalid)");
    } catch (_) { missing.push("GOOGLE_REDIRECT_URI (invalid)"); }
  }
  return { valid: missing.length === 0, missing };
};

const emit = (event, logger = console) => {
  const write = event.outcome === "failed" ? logger.error : logger.info;
  write.call(logger, JSON.stringify(event));
};

const makeApiError = ({ diagnosticId, operation, stage, status, apiStatus, code, message, requestId, retryCount, category, details }) => {
  const safeMessage = redact(message);
  const error = new Error(publicMessage(category));
  error.name = "GoogleAdsApiError";
  error.status = Number.isInteger(status) && status >= 400 && status < 500 ? status : 502;
  error.category = category;
  error.diagnosticId = diagnosticId;
  error.diagnostic = {
    diagnosticId,
    operation,
    stage,
    outcome: "failed",
    category,
    ...(Number.isInteger(status) ? { httpStatus: status } : {}),
    ...(apiStatus ? { googleAdsStatus: redact(apiStatus) } : {}),
    ...(code ? { googleAdsErrorCode: redact(typeof code === "object" ? Object.entries(code).map(([key, value]) => `${key}.${value}`).join(",") : code) } : {}),
    ...(safeMessage ? { googleAdsErrorMessage: safeMessage } : {}),
    ...(requestId ? { googleAdsRequestId: redact(requestId) } : {}),
    retryCount,
    timestamp: new Date().toISOString(),
    ...(details?.length ? { googleAdsErrorDetails: sanitizeDetails(details) } : {}),
  };
  return error;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryAfterMillis = (headers) => {
  const value = responseHeader(headers, "retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
};

const requestGoogleAdsApi = async ({
  operation,
  stage = "google_ads_http_request",
  endpoint,
  method = "GET",
  body,
  customerId,
  loginCustomerId,
  managerCustomerId,
  connectionId,
  refreshToken,
  accessToken,
  // GET is safe by default. Every other method is non-retryable unless the
  // caller explicitly identifies an idempotent read (for example GAQL search).
  operationKind = method.toUpperCase() === "GET" ? "read" : "mutation",
  retryPolicy = method.toUpperCase() === "GET" ? "safe" : "never",
  diagnosticId = crypto.randomUUID(),
  timeoutMs = 30000,
  onDiagnostic,
  fetchImpl = fetch,
}) => {
  if (!operation || !endpoint || !endpoint.startsWith("/")) throw new TypeError("operation and absolute API endpoint path are required");
  const canRetry = operationKind === "read" && retryPolicy === "safe";
  const configuration = validateGoogleAdsConfiguration();
  if (!configuration.valid) {
    const error = makeApiError({ diagnosticId, operation, stage: "configuration_validation", code: "GOOGLE_ADS_CONFIGURATION_MISSING", message: `Missing Google Ads configuration: ${configuration.missing.join(", ")}`, retryCount: 0, category: "developer_token_or_access_level" });
    emit(error.diagnostic);
    onDiagnostic?.(error.diagnostic, error);
    throw error;
  }
  let normalizedCustomerId;
  let normalizedLoginCustomerId;
  try {
    normalizedCustomerId = customerId ? normalizeCustomerId(customerId) : null;
    normalizedLoginCustomerId = managerCustomerId || loginCustomerId
      ? normalizeCustomerId(managerCustomerId || loginCustomerId)
      : null;
  } catch (error) {
    const apiError = makeApiError({ diagnosticId, operation, stage: "customer_id_validation", code: "INVALID_CUSTOMER_ID", message: error.message, retryCount: 0, category: "invalid_request" });
    emit(apiError.diagnostic);
    onDiagnostic?.(apiError.diagnostic, apiError);
    throw apiError;
  }
  if (normalizedLoginCustomerId && !normalizedCustomerId) throw new TypeError("login-customer-id requires a target customer ID");
  const target = endpoint.replace(":customerId", normalizedCustomerId || "");
  if (target.includes(":customerId")) throw new TypeError("customerId is required for this endpoint");
  const requestContext = {
    apiVersion: googleAdsVersion, method,
    ...(normalizedCustomerId ? { customerId: normalizedCustomerId } : {}),
    ...(normalizedLoginCustomerId && normalizedLoginCustomerId !== normalizedCustomerId ? { loginCustomerId: normalizedLoginCustomerId } : {}),
    ...queryStructure(body),
  };
  if (body?.query) emit({ diagnosticId, operation, stage, outcome: "started", ...requestContext, timestamp: new Date().toISOString() });
  let currentToken = accessToken || null;
  let forceRefresh = false;
  let authRefreshes = 0;

  const getToken = async () => {
    if (connectionId) return getAccessTokenForConnection(connectionId, { forceRefresh });
    if (forceRefresh && refreshToken) {
      const oauth = createGoogleOAuthClient();
      oauth.setCredentials({ refresh_token: refreshToken });
      const result = await oauth.refreshAccessToken();
      return result.credentials?.access_token || null;
    }
    if (currentToken) return currentToken;
    if (refreshToken) {
      const oauth = createGoogleOAuthClient();
      oauth.setCredentials({ refresh_token: refreshToken });
      return (await oauth.getAccessToken()).token;
    }
    throw Object.assign(new Error("No Google Ads OAuth token is available"), { category: "token_refresh_or_revocation", code: "OAUTH_TOKEN_MISSING" });
  };

  for (let attempt = 1; ; attempt++) {
    try {
      const token = await getToken();
      if (!token) throw Object.assign(new Error("Google Ads OAuth access token is unavailable"), { code: "OAUTH_TOKEN_MISSING" });
      currentToken = token;
      const headers = {
        Authorization: `Bearer ${token}`,
        ...(String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim()
          ? { "developer-token": String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN).trim() }
          : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(normalizedLoginCustomerId && normalizedLoginCustomerId !== normalizedCustomerId
          ? { "login-customer-id": normalizedLoginCustomerId }
          : {}),
      };
      const response = await fetchImpl(`${API_ROOT}${target}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      let payload;
      let malformedJson = false;
      try { payload = await response.json(); }
      catch (_) { malformedJson = true; }
      if (!response.ok) {
        const apiError = extractGoogleAdsError(payload);
        const requestId = responseHeader(response.headers, "request-id") || responseHeader(response.headers, "google-ads-request-id") || apiError.requestId;
        const category = classify({ status: response.status, code: apiError.code, message: apiError.message });
        if (response.status === 401 && canRetry && (connectionId || refreshToken) && authRefreshes < 1) {
          authRefreshes++;
          forceRefresh = true;
          emit({ diagnosticId, operation, stage: "token_refresh", outcome: "retrying", category: "authentication", retryCount: attempt - 1, timestamp: new Date().toISOString() });
          continue;
        }
        if (canRetry && RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
          const retryAfter = retryAfterMillis(response.headers);
          const delay = Math.min(60000, Math.max(250 * 2 ** (attempt - 1) + Math.random() * 150, retryAfter));
          emit({ diagnosticId, operation, stage, outcome: "retrying", category, httpStatus: response.status, ...(apiError.code ? { googleAdsErrorCode: redact(apiError.code) } : {}), ...(requestId ? { googleAdsRequestId: redact(requestId) } : {}), retryCount: attempt, timestamp: new Date().toISOString() });
          await wait(delay);
          continue;
        }
        throw makeApiError({ diagnosticId, operation, stage, status: response.status, apiStatus: apiError.apiStatus, code: apiError.code, message: apiError.message, requestId, retryCount: attempt - 1, category, details: apiError.details });
      }
      if (malformedJson) {
        throw makeApiError({ diagnosticId, operation, stage, status: response.status, message: "Google Ads returned malformed JSON", requestId: responseHeader(response.headers, "request-id") || responseHeader(response.headers, "google-ads-request-id"), retryCount: attempt - 1, category: "unexpected_internal_error" });
      }
      const requestId = responseHeader(response.headers, "request-id") || responseHeader(response.headers, "google-ads-request-id");
      const result = { diagnosticId, operation, stage, outcome: "succeeded", ...(requestId ? { googleAdsRequestId: redact(requestId) } : {}), retryCount: attempt - 1, timestamp: new Date().toISOString() };
      emit(result);
      onDiagnostic?.(result, null);
      return payload;
    } catch (error) {
      if (error?.name === "GoogleAdsApiError") {
        error.diagnostic = sanitizeDetails({ ...error.diagnostic, ...requestContext }, 0, [currentToken, refreshToken]);
        emit(error.diagnostic);
        onDiagnostic?.(error.diagnostic, error);
        throw error;
      }
      if (error?.category || error?.code === "RECONNECT_REQUIRED" || error?.code === "OAUTH_TOKEN_MISSING") {
        const category = error.category || "token_refresh_or_revocation";
        const apiError = makeApiError({ diagnosticId, operation, stage: "token_refresh", status: error.status, code: error.code, message: error.message, retryCount: attempt - 1, category, details: error.diagnostic });
        emit(apiError.diagnostic);
        onDiagnostic?.(apiError.diagnostic, apiError);
        throw apiError;
      }
      if (["invalid_grant", "invalid_token"].includes(error?.response?.data?.error)) {
        const apiError = makeApiError({ diagnosticId, operation, stage: "token_refresh", code: error.response.data.error, message: "Google Ads refresh token is invalid or revoked", retryCount: attempt - 1, category: "token_refresh_or_revocation" });
        emit(apiError.diagnostic);
        onDiagnostic?.(apiError.diagnostic, apiError);
        throw apiError;
      }
      const networkCode = error?.cause?.code || error?.code;
      const category = classify({ code: networkCode, message: error?.message });
      const retryable = canRetry && attempt < MAX_ATTEMPTS && (RETRYABLE_NETWORK_CODES.has(networkCode) || error?.name === "TimeoutError" || error?.name === "AbortError" || (error?.name === "TypeError" && /fetch failed|network/i.test(error.message)));
      if (retryable) {
        const delay = Math.min(5000, 250 * 2 ** (attempt - 1) + Math.random() * 150);
        emit({ diagnosticId, operation, stage, outcome: "retrying", category, ...(networkCode ? { errorCode: redact(networkCode) } : {}), retryCount: attempt, timestamp: new Date().toISOString() });
        await wait(delay);
        continue;
      }
      const apiError = makeApiError({ diagnosticId, operation, stage, code: networkCode, message: error?.message || "Network request failed", retryCount: attempt - 1, category });
      emit(apiError.diagnostic);
      onDiagnostic?.(apiError.diagnostic, apiError);
      throw apiError;
    }
  }
};

module.exports = { requestGoogleAdsApi, normalizeCustomerId, decamelizeKeys, validateGoogleAdsConfiguration, classify, redact, API_ROOT, MAX_ATTEMPTS };
