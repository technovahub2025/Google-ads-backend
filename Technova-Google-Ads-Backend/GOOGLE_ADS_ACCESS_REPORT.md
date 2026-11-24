# Super Admin and Client access — 16 November 2026

## Cause

The embedded `App.jsx` deliberately redirected Super Admin from every management page through `CustomerCampaignPage`. Its index route then displayed `Clients` rather than Dashboard. Backend `authorizeGoogleAdsAccount` separately rejected Super Admin operations with "cannot operate campaigns" and limited campaign reads to customers with existing Client assignments.

The parent sidebar, parent wildcard route and iframe suffix forwarding were already correct. They were not changed in this continuation.

## Access changes

- The embedded session guard permits both authenticated roles and redirects missing/expired sessions to `/login`. A backend 401 during connection checking also redirects to login. UI role detection uses the same NEXION JWT used for API calls; cached browser user objects do not override it. This does not verify JWT signatures in the browser: backend authentication remains authoritative.
- `/google-ads` now shows Dashboard for both roles. The existing Client management page moves to `/google-ads/clients`, restricted to Super Admin, and its back links were updated. Linking and assignment operations are unchanged.
- A shared account selector uses the existing `/connection` and `/customer-accounts` endpoints. Super Admin sees discovered non-manager customers across connected records; Clients receive only their assigned connection and filtered customer list. Selections are retained across embedded reloads in session storage and checked against the current authorized options before use.
- All six pages consume the selected customer/connection. Management reads and writes explicitly pass both IDs; form values cannot override the selected scope. Account changes discard old read results and avoid showing acknowledgements for a previous account.
- For management endpoints, Super Admin must supply an active connection and a valid customer ID that the existing Google discovery service confirms belongs to that connection. No Client assignment is required for Super Admin. Manager accounts cannot be campaign targets.
- Client authorization continues to use the active assignment keyed by authenticated user ID, including company and connection checks. Conflicting query/body selections are rejected for both roles. JWT verification, the live NEXION Client module-grant check, OAuth, refresh-token handling, Firestore records, assignments and client linking were preserved.

## Existing management pages

The existing Campaigns, Budgets, Ad Groups, Ads and Keywords page files are reused. Their sample-data fallbacks and local-only success behavior were replaced with a shared resource manager using the management services prepared earlier in this conversation. No second sidebar or duplicate management endpoint was added.

Supported creation is intentionally limited to Search / Manual CPC campaigns, daily STANDARD budgets, standard Search ad groups, responsive search ads and Search keywords. New campaigns, ad groups, ads and keywords are PAUSED. Enabling requires an explicit action and confirmation. Other campaign/ad types remain visible but unsupported edit actions are disabled. Keyword text and match type are immutable; create/status/remove are available rather than pretending text edits succeed. Total budgets are displayed but cannot be edited through this form.

The live check found an additional failure in the unfinished management query: Google returned `queryError.UNRECOGNIZED_FIELD` for `campaign.start_date` and `campaign.end_date`, request ID `jgqlGlPsf8e7f3Yk3cu0KA`. These were replaced with `campaign.start_date_time` and `campaign.end_date_time`, and matching create/update fields and masks were corrected. Daily date input uses account-local `00:00:00` and `23:59:59`. See [the v25 campaign reference](https://developers.google.com/google-ads/api/fields/v25/campaign). Existing dashboard reporting queries were not changed.

## Changed files in this continuation

Frontend (`D:/googleads/googleads-frontend`):

- `App.jsx`
- `components/google-ads/GoogleAdsLayout.jsx`
- `components/google-ads/CampaignCreationWizard.jsx`
- `components/google-ads/GoogleAdsResourceManager.jsx` (new)
- `context/GoogleAdsContext.jsx`
- `context/GoogleAdsAccountContext.jsx` (new)
- `context/useDashboardData.js`
- `services/googleAdsApi.js`
- `utils/googleAdsManagement.js` (new)
- `pages/google-ads/Dashboard.jsx`
- `pages/google-ads/Campaigns.jsx`
- `pages/google-ads/Budgets.jsx`
- `pages/google-ads/AdGroups.jsx`
- `pages/google-ads/Ads.jsx`
- `pages/google-ads/Keywords.jsx`
- `pages/google-ads/Clients.jsx`
- `test/access.test.js` (new)
- `test/dashboard.test.js`

Backend (`D:/googleads/Technova-Google-Ads-Backend`):

- `middleware/nexionAuth.js`
- `services/googleAdsManagementService.js` (previously prepared locally; date fields corrected here)
- `test/googleAdsAccess.test.js` (new)
- `test/googleAdsClientOAuth.test.js` (old Super Admin-denial expectations updated to scoped access)
- This report.

Other local changes shown by Git predate this continuation and were preserved.

## Validation and limits

- Backend: **61 tests passed**. Tests verify signed JWT authentication, denied unsigned/forged tokens, Client module grants, Super Admin access across multiple discovered customers/connections, Client isolation, rejected cross-customer and cross-connection IDs, conflicting body/query IDs, required account parameters, safe PAUSED creation defaults, atomic budget/campaign construction and resource-specific updates. Every tested mutation used a mocked transport.
- Frontend: **12 tests passed**. Tests render all six direct routes for both roles, exercise the real session-guard decision for missing/expired sessions, check account switching, validate management payloads, verify selected scope overrides form IDs, and preserve dashboard KPI/date/error tests.
- Frontend `npm run build`: **passed**.
- Read-only live lists against existing customer `6803148513`: campaigns, budgets, ad groups, ads and keywords all succeeded with empty results. Google request IDs: `ltBhdKOlhlPsI1pf8MP6JQ`, `1ruqAIgcPWL_aPmY8iZqxg`, `Q-o4xvXpwVl9VhFUrm_n3w`, `6zN1S5HjgtzNKc42W3jEsA`, `U1lKGagD1jaaP2xKIuR7Jg`.
- Frontend `git diff --check` passed. The full backend/root check still reports pre-existing trailing whitespace at `config/googleOAuth.js:7`; that restricted file was not changed.
- No authenticated browser session was available for a full browser interaction check. Live mutations were intentionally not run. Google account-level policy, billing and API eligibility can still reject an otherwise well-formed request, and errors are propagated.
- Customer options use the existing directly accessible account discovery. Automatic traversal of MCC-only customer hierarchies was not added in this access change.

No parent frontend changes, OAuth changes, Firestore writes, assignment/linking changes, commits, pushes or deployment were performed in this continuation. Live verification refreshed the existing token only in memory to avoid credential persistence.
