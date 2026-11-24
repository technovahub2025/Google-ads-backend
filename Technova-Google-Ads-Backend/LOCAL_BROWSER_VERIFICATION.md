# Local browser verification — 16 November 2026

Result: **partial browser verification completed; neither authenticated session is ready**. Application source was not changed. No login or mutation form was submitted. No authentication was bypassed and no existing browser profile/session was copied.

## Actual service configuration and availability

| Service | Confirmed local address | Probe | Result |
| --- | --- | --- | --- |
| Parent NEXION frontend | http://localhost:5173 | GET /login | HTTP 200; Chromium renders Welcome back |
| Embedded Google Ads frontend | http://localhost:5174 | GET /google-ads | HTTP 200 HTML; unauthenticated browser redirects to /login |
| NEXION admin backend | http://localhost:8000 | GET /api/user/credentials without authentication | HTTP 401, message: No token provided |
| Google Ads backend | http://localhost:8001 | GET / | HTTP 200, success: true |
| Google Ads backend authentication | http://localhost:8001 | GET /api/google-ads/connection without authentication | HTTP 401, success: false, message: Nexion authentication missing or invalid |

All four ports had live listeners and responded. Parent Vite fixes port 5173 with strictPort; embedded Vite does not fix a port in vite.config.js, but the running service was confirmed at 5174. Both backend startup files use their configured PORT values, 8000 and 8001. Neither inspected Vite configuration defines an API proxy.

The parent `.env.local` embeds `http://localhost:5174/google-ads`. The embedded app trusts `http://localhost:5173` as its parent. The parent's admin API resolver selects `http://localhost:8000` on localhost. The Google Ads backend uses that same address for NEXION module-grant verification.

**Local-only configuration limitation:** the embedded app's actual API setting points to `https://guise-oblivion-bobsled.ngrok-free.dev`, not directly to localhost:8001. Its tunnel destination was not verified. No environment setting or OAuth setting was changed to conceal this difference.

## Login mechanisms and account prerequisites

- Parent `/login` submits email/password to local `POST /api/nexion/login`; on HTTP 401 it tries `POST /superadmin/login`. Firebase Google and phone-OTP login options also exist. None was submitted during this verification.
- Successful login normally establishes the parent session through AuthContext, and the existing origin-checked iframe bridge supplies the embedded app's session. No token, password, cookie or existing session was extracted, printed, copied or requested.
- Backend signing configuration is present in both projects and matched in a boolean-only comparison. No signing value was exposed.
- Read-only, explicitly projected account inventory found one Super Admin record and one non-Super-Admin record with the Google Ads module grant. The linked Client has role `admin`, module grant true, an active assignment to customer **6803148513**, and an active Google Ads connection. No password/hash or token fields were selected.
- The Client record has `isEnabled: false`, but its role is `admin`. Existing login code applies the disabled-agent rejection only to agent workspaces, so this flag alone is not a verified login blocker. It was not changed.
- No dedicated account-seeding script was identified in the admin backend's scripts directory. The Google Ads backend has no scripts directory. No new accounts, grants or assignments were created.

**Authenticated-session blocker:** the configured admin database is remote MongoDB Atlas, and the existing Google Ads records were read from cloud Firestore. These are not confirmed disposable local test fixtures. Normal credential login executes `await user.save()` at `D:/nexion/nexion-admin-node-backend/controller/login.js:104`, `ensureTrialForUser` at line 107, and may perform company/cloud-storage setup. Submitting login could therefore change remote data even without a Google Ads mutation. No credential values are available through an allowed interactive sign-in channel, and none was requested or extracted from source code. Both roles remain **NOT ESTABLISHED**.

## Browser method and results

Used installed Chromium with a new temporary profile and its DevTools protocol. No browser automation package was installed. The harness allowed only GET/HEAD/OPTIONS to loopback hosts and blocked every write request and every nonlocal request. It recorded sanitized URLs/statuses, runtime exceptions and console.error calls without reading session values. The browser was closed afterward.

Pages actually opened:

- Parent: `/login`, `/google-ads`.
- Embedded: `/google-ads`, `/google-ads/campaigns`, `/google-ads/budgets`, `/google-ads/ad-groups`, `/google-ads/ads`, `/google-ads/keywords`.

These were unauthenticated visits, not authenticated management-screen verification. All embedded routes displayed the NEXION sign-in message after redirecting to `/login`. The parent protected route redirected to its own `/login`. Login views were not blank.

| Requested scenario | Status | Evidence / limitation |
| --- | --- | --- |
| 1. Super Admin navigates all six pages | NOT TESTED | No authenticated Super Admin session |
| 2. Super Admin switches authorized customers/connections | NOT TESTED | No authenticated session; existing linked-customer prerequisite identified only for 6803148513 |
| 3. Each page uses selected customer and correct data | NOT TESTED | Authenticated data requests were not made |
| 4. Selection refresh and stale-response rejection | NOT TESTED | Requires authenticated interactive account switching |
| 5. Client accesses only linked account | NOT TESTED | Assignment and grant confirmed read-only; no Client browser session |
| 6. Client direct-route/API tampering is denied | NOT TESTED | No Client session; unauthenticated modified-ID request returned 401, which does not prove Client isolation |
| 7a. Missing sessions redirect to login | PASS | Observed in Chromium on parent /google-ads and all six embedded routes |
| 7b. Expired sessions redirect to login | NOT TESTED | No actual expired session available; no JWT was manufactured or copied |
| 8. No unexpected redirects, blank pages, console/network errors | FAIL (resource check); authenticated portion NOT TESTED | Login redirects were expected and views rendered; favicon returned 404. No uncaught JS exception or console.error call was captured on tested views. Policy-blocked requests are listed separately below. |

Customer IDs used: **6803148513** for read-only prerequisite inspection and an unauthenticated API request. No Google Ads customer was opened in an authenticated browser session. This run did not repeat the earlier live Google Ads data checks or count prior mocked tests as browser passes.

## Sanitized request/error evidence

Observed browser request:

```text
GET http://localhost:8001/api/google-ads/campaigns?connectionId=unknown&customerId=6803148513
No Authorization header
HTTP 401
{"success":false,"message":"Nexion authentication missing or invalid"}
```

The browser request was deliberately unauthenticated. No valid connection identifier or session secret was needed.

Actual resource error:

```text
GET http://localhost:5174/favicon.ico
HTTP 404
```

Harness-induced blocks, not proof of an application/API outage:

```text
GET https://fonts.googleapis.com/css2
Blocked by verification policy; net::ERR_BLOCKED_BY_CLIENT.Inspector

OPTIONS / GET https://guise-oblivion-bobsled.ngrok-free.dev/api/google-ads/connection
Blocked by local-only verification policy; net::ERR_BLOCKED_BY_CLIENT
```

The embedded provider attempted its configured connection check even on the unauthenticated login view. The ngrok target was not contacted, so its actual status is unknown. No authenticated request payloads, creation requests, or live mutations were captured/submitted.

Campaign creation was inspected in source only: the form builds a Search/Manual-CPC request, defaults to PAUSED and passes the selected connection/customer through the API helper. Its actual authenticated browser UI/request construction remains **NOT TESTED** in this run.

## Safe prerequisites and manual verification steps

Before attempting authentication, the project owner must confirm the configured remote databases are approved for ordinary login writes, or prepare an isolated local test environment. A safe local-only alternative is a disposable MongoDB database and isolated Firestore emulator/test fixture, with one Super Admin and one Client configured privately, a module grant and active assignment only in that fixture. This is a proposal, not a setup performed here. Do not copy production credentials or records into it. Synthetic Google Ads responses can support an isolated UI rehearsal but must be reported as mocked rather than live end-to-end verification.

For a strictly local API path, an approved test process can override `VITE_GOOGLE_ADS_API_URL=http://localhost:8001` in its process environment and restart the embedded Vite service on 5174. This would not require changing OAuth configuration. Do not overwrite the existing environment file silently. No such override was applied in this run.

Once login writes are approved for the chosen environment and the owner can enter existing credentials privately:

1. Open two separate browser profiles, one for Super Admin and one for Client. Open `http://localhost:5173/login` in each and use the existing sign-in flow. Do not paste credentials or sessions into chat or console.
2. Confirm each profile reaches the expected authenticated landing page. A profile is ready only after that and an authenticated API response have been verified.
3. Navigate with the parent Google Ads submenu through Dashboard, Campaigns, Budgets, Ad Groups, Ads and Keywords. Confirm the parent retains the route while the iframe receives its suffix.
4. In the Super Admin profile, note only the customer IDs in the authorized account selector. Switch across available customers/connections and verify each list request's `customerId` and connection selection in DevTools. Do not export headers, cookies, HAR files or response bodies containing sessions.
5. Switch quickly between accounts while requests are pending. Confirm the final selector and page data belong to the last selection. This needs a second authorized account; do not create or reassign a production account to obtain one.
6. In the Client profile, confirm only the linked customer appears. Use a read-only list request with a different customer ID and verify HTTP 403. A direct URL query must not cause another customer's data to render. Do not send any POST/PUT/PATCH/DELETE Google Ads management request.
7. Open Create Campaign and inspect its inputs. If request capture is needed, first install a browser-only route interceptor that blocks the campaign POST before transmission. Never submit Save against the live backend. Confirm the constructed request is PAUSED and uses the selected customer, then discard it.
8. Use a fresh browser profile for the missing-session checks. For expiry, use a genuinely expired session from an approved test environment or allow a test-issued session to expire; do not manufacture or import a production JWT.
9. Inspect console and network failures on every page. Record only sanitized paths, statuses, messages and customer IDs. Resolve the favicon 404 separately if desired; it was not fixed merely to make verification pass.

## Files and data changed

Only this report was added: `D:/googleads/Technova-Google-Ads-Backend/LOCAL_BROWSER_VERIFICATION.md`. No application source/configuration was edited. A fresh temporary Chromium profile was created for the read-only browser run; no existing profile/session was copied. No OAuth, assignment, linking, account, production data, commit, push or deployment change was made.
