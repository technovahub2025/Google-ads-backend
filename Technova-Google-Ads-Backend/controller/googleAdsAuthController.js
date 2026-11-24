const crypto = require("crypto");
const {
  googleOAuthClient,
  GOOGLE_ADS_SCOPE,
} = require("../config/googleOAuth");
const { saveGoogleAdsConnection, saveClientGoogleAdsConnection, getGoogleAdsClient, getGoogleAdsConnection, saveOAuthState, getOAuthState, consumeOAuthState, releaseOAuthState, completeOAuthState, createOAuthCompletion, consumeOAuthCompletion } = require("../model/GoogleAdsConnection");
const { getAccessibleCustomerAccountsForToken } = require("../services/googleAdsCustomerService");

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_COMPLETION_MAX_AGE_MS = 5 * 60 * 1000;

const summarizeDiscoveredAccounts = (accounts) => accounts.map((row) => {
  const customer = row?.customer || row;
  return {
    id: String(customer?.id || customer?.resourceName?.split("/").pop() || ""),
    name: String(customer?.descriptive_name || customer?.descriptiveName || customer?.name || ""),
    currency: String(customer?.currency_code || customer?.currencyCode || ""),
    timeZone: String(customer?.time_zone || customer?.timeZone || ""),
    manager: customer?.manager === true,
  };
}).filter((account) => account.id);

const sanitizeLogText = (value) => String(value || "")
  .replace(/\b(Bearer\s+)\S+/gi, "$1[REDACTED]")
  .replace(/["']?\b(access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|authorization[_ -]?code|code|state|invitation[_ -]?token)["']?(\s*[:=]\s*)["']?[^\s,"'}]+["']?/gi, "$1$2[REDACTED]")
  .replace(/https?:\/\/\S+/gi, "[URL]")
  .slice(0, 500);

const getSafeErrorDetails = (error) => {
  const response = error?.response;
  const diagnostic = error?.diagnostic || {};
  const status = Number(error?.status || response?.status || error?.code);
  const codeValue = error?.code;
  const code = typeof codeValue === "string" || typeof codeValue === "number" ? sanitizeLogText(codeValue) : undefined;
  const diagnosticStatus = Number(diagnostic.httpStatus);
  return {
    errorName: sanitizeLogText(error?.name || "Error"),
    errorMessage: sanitizeLogText(diagnostic.message || error?.message || "Unknown error"),
    ...(code ? { errorCode: code } : {}),
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { httpStatus: status } : {}),
    ...(diagnostic.errorCode ? { googleAdsErrorCode: sanitizeLogText(diagnostic.errorCode) } : {}),
    ...(Number.isInteger(diagnosticStatus) && diagnosticStatus >= 100 && diagnosticStatus <= 599 ? { googleAdsHttpStatus: diagnosticStatus } : {}),
    ...(typeof (diagnostic.requestId || diagnostic.googleAdsRequestId) === "string" ? { googleAdsRequestId: sanitizeLogText(diagnostic.requestId || diagnostic.googleAdsRequestId) } : {}),
    ...(diagnostic.googleAdsErrorCode ? { googleAdsDetailCode: sanitizeLogText(diagnostic.googleAdsErrorCode) } : {}),
    ...(diagnostic.googleAdsErrorMessage ? { googleAdsDetailMessage: sanitizeLogText(diagnostic.googleAdsErrorMessage) } : {}),
    ...(diagnostic.googleAdsStatus ? { googleAdsStatus: sanitizeLogText(diagnostic.googleAdsStatus) } : {}),
  };
};

const logOAuthDiagnostic = (diagnosticId, stage, outcome, error) => {
  const details = error ? getSafeErrorDetails(error) : {};
  const event = {
    event: "google_ads_diagnostic",
    diagnosticId,
    operation: "oauth_callback",
    stage,
    outcome,
    ...(error?.category || error?.diagnostic?.category ? { category: error.category || error.diagnostic.category } : {}),
    ...(error?.diagnostic?.retryCount !== undefined ? { retryCount: error.diagnostic.retryCount } : { retryCount: 0 }),
    timestamp: new Date().toISOString(),
    ...details,
  };
  (outcome === "failed" ? console.error : console.info)(JSON.stringify(event));
};

const createOAuthState = () => {
  const payload = `${Date.now()}.${crypto.randomBytes(32).toString("hex")}`;
  const signature = crypto
    .createHmac("sha256", process.env.GOOGLE_CLIENT_SECRET)
    .update(payload)
    .digest("hex");

  return `${payload}.${signature}`;
};

const isValidOAuthState = (state) => {
  if (typeof state !== "string") return false;

  const [timestamp, nonce, signature, ...extra] = state.split(".");
  if (!timestamp || !nonce || !signature || extra.length) return false;

  const issuedAt = Number(timestamp);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > OAUTH_STATE_MAX_AGE_MS || issuedAt > Date.now()) {
    return false;
  }

  const payload = `${timestamp}.${nonce}`;
  const expected = crypto
    .createHmac("sha256", process.env.GOOGLE_CLIENT_SECRET)
    .update(payload)
    .digest("hex");
  const providedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

const getGoogleAdsAuthUrl = async (req, res) => {
  try {
    const state = createOAuthState();
    await saveOAuthState(state, req.user, new Date(Date.now() + OAUTH_STATE_MAX_AGE_MS));
    const authUrl = googleOAuthClient.generateAuthUrl({
      access_type: "offline",
      scope: [GOOGLE_ADS_SCOPE],
      prompt: "select_account consent",
      state,
    });
    return res.json({ success: true, authUrl });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Failed to start Google Ads authorization" });
  }
};

const createClientOAuthInvitation = async (clientId, existingState) => {
  const entry = await getGoogleAdsClient(clientId);
  if (!entry) throw new Error("Google Ads client not found");
  const existingConnection = entry.client.connectionId ? await getGoogleAdsConnection(entry.client.connectionId) : null;
  const state = existingState || createOAuthState();
  if (!existingState) await saveOAuthState(state, { clientId,
    nexionUserId: entry.client.nexionUserId || entry.client.userId || null,
    companyId: entry.client.companyId || null,
    expectedConnectionId: entry.client.connectionId || null,
    managerCustomerId: existingConnection?.managerCustomerId || entry.client.managerCustomerId || null,
  }, new Date(Date.now() + OAUTH_STATE_MAX_AGE_MS));
  const callbackUrl = new URL(process.env.GOOGLE_REDIRECT_URI);
  if (!callbackUrl.pathname.endsWith("/auth/callback")) throw new Error("Google redirect URI is not configured for the existing callback");
  callbackUrl.pathname = callbackUrl.pathname.replace(/\/auth\/callback$/, `/client-connect/${encodeURIComponent(state)}`);
  callbackUrl.search = "";
  return { state, invitationUrl: callbackUrl.toString() };
};

const redirectClientOAuthInvitation = async (req, res) => {
  try {
    const { state } = req.params;
    if (!isValidOAuthState(state) || !await getOAuthState(state)) {
      return res.status(410).send("This Google Ads connection link has expired or was already used.");
    }
    const authUrl = googleOAuthClient.generateAuthUrl({
      access_type: "offline",
      scope: [GOOGLE_ADS_SCOPE],
      prompt: "select_account consent",
      state,
    });
    return res.redirect(authUrl);
  } catch (_) {
    return res.status(500).send("Unable to start Google Ads authorization.");
  }
};

const googleAdsOAuthCallback = async (req, res) => {
  const diagnosticId = crypto.randomUUID();
  const stateAttemptId = crypto.randomUUID();
  let claimedState = false;
  let stage = "oauth_state_validation";
  try {
    const { code, state, error } = req.query;

    if (error) {
      logOAuthDiagnostic(diagnosticId, "authorization_response", "failed", Object.assign(new Error("Authorization was declined or not completed"), { code: "OAUTH_DENIED" }));
      return res.status(400).json({
        success: false,
        message: "Google Ads authorization was not completed",
      });
    }

    if (!code) {
      logOAuthDiagnostic(diagnosticId, "authorization_code_validation", "failed", Object.assign(new Error("Authorization code was missing"), { code: "OAUTH_CODE_MISSING" }));
      return res.status(400).json({
        success: false,
        message: "Authorization code is missing",
      });
    }

    if (!isValidOAuthState(state)) {
      logOAuthDiagnostic(diagnosticId, stage, "failed", Object.assign(new Error("OAuth state is invalid or expired"), { code: "OAUTH_STATE_INVALID" }));
      return res.status(400).json({
        success: false,
        message: "OAuth state is invalid or expired",
      });
    }
    logOAuthDiagnostic(diagnosticId, stage, "succeeded");

    stage = "oauth_state_consumption";
    const identity = await consumeOAuthState(state, stateAttemptId);
    if (!identity) {
      logOAuthDiagnostic(diagnosticId, stage, "failed", Object.assign(new Error("OAuth state is missing, expired, or already consumed"), { code: "OAUTH_STATE_UNAVAILABLE" }));
      return res.status(400).json({ success: false, message: "OAuth state is invalid or expired" });
    }
    claimedState = true;
    logOAuthDiagnostic(diagnosticId, stage, "succeeded");

    stage = "authorization_code_exchange";
    const { tokens } = await googleOAuthClient.getToken(code);
    logOAuthDiagnostic(diagnosticId, stage, "succeeded");
    stage = "refresh_token_validation";
    if (!tokens?.refresh_token) {
      logOAuthDiagnostic(diagnosticId, stage, "failed", Object.assign(new Error("Google did not return a refresh token"), { code: "OAUTH_REFRESH_TOKEN_MISSING" }));
      await releaseOAuthState(state, stateAttemptId);
      claimedState = false;
      return res.status(400).json({
        success: false,
        message: "Refresh token was not received",
      });
    }
    logOAuthDiagnostic(diagnosticId, stage, "succeeded");

    let result;
    if (identity.clientId) {
      let accounts = [];
      if (!identity.expectedConnectionId) {
        stage = "accessible_customer_discovery";
        accounts = await getAccessibleCustomerAccountsForToken(tokens.refresh_token, { accessToken: tokens.access_token, diagnosticId, managerCustomerId: identity.managerCustomerId, authSource: "oauth_authorization_code_exchange",
          onDiagnostic: (event, lookupError) => {
            stage = event;
            logOAuthDiagnostic(diagnosticId, event, lookupError ? "failed" : "succeeded", lookupError);
          } });
      }
      const discoveredAccounts = summarizeDiscoveredAccounts(accounts);
      const customerIds = [...new Set(discoveredAccounts.map((account) => account.id))];
      stage = "firestore_connection_persistence";
      result = await saveClientGoogleAdsConnection({ identity, refreshToken: tokens.refresh_token, customerIds,
        accessToken: tokens.access_token, accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        managerCustomerId: identity.managerCustomerId, googleAdsAccounts: discoveredAccounts });
    } else {
      let discoveredAccounts = [];
      if (identity.companyId) {
        stage = "shared_company_account_discovery";
        try {
          const accounts = await getAccessibleCustomerAccountsForToken(tokens.refresh_token, {
            accessToken: tokens.access_token,
            diagnosticId,
            managerCustomerId: identity.managerCustomerId,
            authSource: "oauth_authorization_code_exchange",
            onDiagnostic: (event, lookupError) => {
              stage = event;
              logOAuthDiagnostic(diagnosticId, event, lookupError ? "failed" : "succeeded", lookupError);
            },
          });
          discoveredAccounts = summarizeDiscoveredAccounts(accounts);
        } catch (discoveryError) {
          // Persist OAuth so an API discovery outage does not discard a valid connection.
          logOAuthDiagnostic(diagnosticId, "shared_company_account_discovery", "failed", discoveryError);
        }
      }
      const googleAccount = discoveredAccounts.length === 1 ? discoveredAccounts[0] : null;
      stage = "firestore_connection_persistence";
      result = { connectionId: await saveGoogleAdsConnection({
      refreshToken: tokens.refresh_token,
      nexionUserId: identity.nexionUserId,
      companyId: identity.companyId,
      managerCustomerId: identity.managerCustomerId,
      customerId: googleAccount?.id,
      googleAccount,
      googleAdsAccounts: discoveredAccounts,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      }) };
    }
    logOAuthDiagnostic(diagnosticId, stage, "succeeded");
    stage = "oauth_state_finalization";
    try {
      const completed = await completeOAuthState(state, stateAttemptId);
      if (completed) claimedState = false;
      logOAuthDiagnostic(diagnosticId, stage, completed ? "succeeded" : "failed", completed ? null : Object.assign(new Error("OAuth state claim could not be finalized"), { code: "OAUTH_STATE_FINALIZATION_FAILED" }));
    } catch (stateError) {
      logOAuthDiagnostic(diagnosticId, stage, "failed", stateError);
      // Connection persistence already succeeded; don't report a failed connection because state cleanup failed.
      claimedState = false;
    }

    if (identity.clientId) {
      const completionCredential = await createOAuthCompletion({
        clientId: identity.clientId,
        connectionId: result.connectionId,
        customerId: result.customerId,
      }, new Date(Date.now() + OAUTH_COMPLETION_MAX_AGE_MS));
      const frontendUrl = String(process.env.GOOGLE_ADS_FRONTEND_URL || "").trim();
      if (frontendUrl) {
        try {
          const completionUrl = new URL("/google-ads/connected", frontendUrl);
          completionUrl.hash = `completion=${completionCredential}`;
          return res.redirect(completionUrl.toString());
        } catch (_) {
          return res.status(500).json({ success: false, message: "Google Ads completion URL is not configured correctly" });
        }
      }
      return res.json({
        success: true,
        message: "Google Ads authorization successful",
        connectionSaved: true,
        ...result,
        completionCredential,
        clientId: identity.clientId,
        accountSelectionRequired: !result.customerId,
      });
    }

    return res.json({
      success: true,
      message: "Google Ads authorization successful",
      connectionSaved: true,
      ...result,
      ...(identity.clientId ? { clientId: identity.clientId, accountSelectionRequired: !result.customerId } : {}),
    });
  } catch (callbackError) {
    logOAuthDiagnostic(diagnosticId, stage, "failed", callbackError);
    if (claimedState) {
      try { await releaseOAuthState(req.query.state, stateAttemptId); }
      catch (releaseError) { logOAuthDiagnostic(diagnosticId, "oauth_state_release", "failed", releaseError); }
    }

    return res.status(callbackError.status || 500).json({
      success: false,
      message: callbackError.status ? callbackError.message : "Google Ads authorization failed. Request a new invitation to retry.",
      diagnosticId,
    });
  }
};

const completeClientOAuth = async (req, res) => {
  const completion = await consumeOAuthCompletion(req.body?.completion);
  if (!completion) return res.status(410).json({ success: false, message: "This Google Ads completion link has expired or was already used." });
  return res.json({
    success: true,
    connectionSaved: true,
    clientId: completion.clientId,
    connectionId: completion.connectionId,
    ...(completion.customerId ? { customerId: completion.customerId } : {}),
    accountSelectionRequired: !completion.customerId,
  });
};

module.exports = {
  getGoogleAdsAuthUrl,
  createClientOAuthInvitation,
  redirectClientOAuthInvitation,
  googleAdsOAuthCallback,
  completeClientOAuth,
};
