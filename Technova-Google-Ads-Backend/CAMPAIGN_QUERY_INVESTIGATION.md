# Campaign query investigation — 16 November 2026

The dashboard findings in this historical investigation have since been addressed. See [DASHBOARD_INTEGRATION.md](DASHBOARD_INTEGRATION.md) for the implementation and verification results; the corrected campaign-list GAQL remains unchanged.

The failure was reproduced against the existing authorized customer `6803148513` before changing the query. Google rejected a nonexistent field, `campaign.budget_amount_micros`. Replacing it with `campaign_budget.amount_micros` resolved the HTTP 400.

No saved backend log files or running listener on port 8001 were available during this investigation. The evidence below comes from fresh live requests using the existing Firestore connection. No OAuth reconnection, new connection, Firestore write, assignment change, permission change, invitation change, commit, or deployment was performed. Access tokens for live verification were obtained with the existing refresh token and retained only in memory, bypassing the production token provider's persistence during the test process.

## Request path

`GET /api/google-ads/campaigns?connectionId=5OV9guIsGvJ3gAkzzhbF&customerId=6803148513`

- Mount: `server.js` → `/api/google-ads`.
- Route: `route/googleAdsCampaignRoutes.js` → `router.get("/campaigns", getCampaignList)`.
- Controller: `controller/googleAdsCampaignController.js` → `getCampaignList` reads both query parameters.
- Service: `services/googleAdsCampaignService.js` → `getCampaigns(connectionId, customerId)`, operation `campaign_list`, stage `campaign_query`.
- Transport: `services/googleAdsApiClient.js` → `requestGoogleAdsApi`.
- Google endpoint: `POST https://googleads.googleapis.com/v25/customers/6803148513/googleAds:search`.
- JSON body contains only `query`. No page size, page token, validation flag, WHERE clause, date filter, segment, LIMIT, or GAQL PARAMETERS clause is supplied. Results are ordered by `campaign.id`.
- Customer ID is normalized by removing hyphens and validating exactly ten digits. The existing active assignment points to this customer and connection. No manager ID was configured or sent as `login-customer-id` in the reproduced request.

## Original GAQL

```sql
SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  campaign.budget_amount_micros,
  metrics.impressions,
  metrics.clicks,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros,
  metrics.conversions
FROM campaign
ORDER BY campaign.id
```

## Exact Google failure

Captured at `2026-11-16T05:03:35.972Z` (10:33:35 IST):

```json
{
  "httpStatus": 400,
  "googleAdsStatus": "INVALID_ARGUMENT",
  "googleAdsErrorCode": "queryError.UNRECOGNIZED_FIELD",
  "googleAdsErrorMessage": "Unrecognized field in the query: 'campaign.budget_amount_micros'.",
  "googleAdsRequestId": "OVPMFeS_iUrGeFYe-Gy_gw",
  "googleAdsErrorDetails": [
    {
      "errorCode": { "queryError": "UNRECOGNIZED_FIELD" },
      "message": "Unrecognized field in the query: 'campaign.budget_amount_micros'."
    }
  ],
  "retryCount": 0,
  "diagnosticId": "46677f8d-3bdf-4982-8b04-fc3af637fdff"
}
```

Google did not supply a separate trigger, field-path location, or additional query-error-details object for this failure. The message itself identifies the invalid field. This is a GAQL schema error, not an OAuth, account discovery, account selection, Firestore, manager-account, or API-version failure.

The old parser only attempted to decode `details[].value` as a base64 protobuf. Standard REST responses expand `GoogleAdsFailure` into `details[].errors` with camelCase `errorCode` and `requestId`. Ignoring that representation hid the precise query error behind the top-level `INVALID_ARGUMENT`.

## Corrected GAQL

```sql
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
```

Only the invalid selected field changed. Budget belongs to the attributed `campaign_budget` resource. All four selected campaign attributes, the budget attribute, and all six selected metrics were verified as selectable through live v25 `googleAdsFields:search` metadata. The complete corrected query succeeded, confirming the selected fields are compatible together with `FROM campaign` and the existing ordering. There are no filter or date expressions to validate.

Reference: [v25 campaign fields](https://developers.google.com/google-ads/api/fields/v25/campaign), [v25 campaign_budget.amount_micros](https://developers.google.com/google-ads/api/fields/v25/campaign_budget#campaign_budget.amount_micros), [Google's REST error structure](https://developers.google.com/google-ads/api/docs/best-practices/understand-api-errors).

## Changes

- Corrected the single GAQL field in `services/googleAdsCampaignService.js`.
- Updated the campaign page's budget mapping in `../googleads-frontend/pages/google-ads/Campaigns.jsx` to consume `campaign_budget.amount_micros` (with camelCase transport compatibility).
- Updated `services/googleAdsApiClient.js` to parse expanded REST failures as well as encoded protobuf failures, retain multiple errors, and preserve error codes, messages, triggers, locations, extra error details, and request IDs including the response-body fallback.
- Added structured query diagnostics with API version, normalized customer/manager context, method, GAQL structure with literal filter values removed, and known request parameter names. Error details are bounded and recursively sanitized. Headers, raw request/response objects, credentials, page tokens, and literal filter values are not logged. Known environment secrets and the in-memory access/refresh tokens are redacted from failure diagnostics.
- Added regression tests for detailed REST error parsing/redaction and the corrected campaign query/account/response mapping.

## Dashboard and client inspection

These additional findings were inspected and are left unchanged to keep the query fix small:

| Area | Finding |
| --- | --- |
| Shared endpoint | Dashboard and client details both use `GET /api/google-ads/campaigns`. Client details calls `getCustomerCampaigns(connectionId, customerId)`; dashboard calls the separate `getCampaigns()` wrapper. |
| Client detail account | `Clients.jsx` passes `selectedAssignment.connectionId` and `selectedAssignment.customerId` and reads `response.campaigns`. |
| Campaign page account | `Campaigns.jsx` passes the selected customer ID and context connection ID through `getCustomerCampaigns`. |
| Dashboard selection | `Dashboard.jsx` stores the selector value only in React state. Changing it reruns the effect, but neither selected account nor date range is passed to the API wrappers. The selection is not persisted across remounts. |
| Dashboard account options | `getAccounts()` maps connected Google identities from `/connection`, not discovered Ads customer accounts. A Google identity's `id` is not necessarily the Ads customer ID. |
| Backend authorization | Assigned non-superadmin requests have their authorized connection/customer injected by existing middleware. Thus a dashboard selection does not change the actual account; superadmin campaign requests without explicit IDs are rejected. No middleware or permissions were changed. |
| Dashboard response mapping | Dashboard reads `campaignsRes.data`; the backend returns `campaigns`. Successful API campaign rows would therefore be discarded. |
| Dashboard charts | Spend, clicks, and conversions charts always read `mockTimeSeriesData`, including when mock mode is disabled. They do not use API time-series responses. |

## Validation

- Original live service request: HTTP 400, `queryError.UNRECOGNIZED_FIELD`, request ID `OVPMFeS_iUrGeFYe-Gy_gw`.
- Live v25 field metadata: all 11 corrected fields returned `selectable: true`; request ID `vgy04T2HQpln8OohVUivAA`.
- Corrected live campaign endpoint via an isolated local Express route/controller harness: HTTP **200**, `success: true`, `customerId: "6803148513"`, `campaigns: []`. Google request ID `590n5WdkWBTPcf32Nv9eVQ`; diagnostic ID `70b3bfa5-36c0-4b15-a0a3-c6cc079d30b1`. The empty list is Google's real result, not fallback/sample data.
- The harness mounted the real campaign router/controller/service and called live Google Ads. It did not test an authenticated browser request or the full production middleware stack; no existing NEXION session was available. Existing authorization regression tests passed separately.
- Backend `npm test`: **54 passed, 0 failed**. The sandbox initially blocked test worker processes (`spawn EPERM`); rerunning outside the sandbox succeeded.
- Frontend `npm run build`: **passed**. The sandbox initially blocked esbuild (`spawn EPERM`); rerunning outside the sandbox succeeded.
- Full root `git diff --check`: reports one pre-existing trailing-whitespace line in `config/googleOAuth.js:7`. That unrelated existing edit was preserved. Checks restricted to the modified tracked campaign service/page pass; the added/previously untracked diagnostic client and test file also pass whitespace checks.
