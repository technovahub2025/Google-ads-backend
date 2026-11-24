# Google Ads dashboard integration — 16 November 2026

The dashboard now loads authorized customer accounts, selects an available customer, and requests real period-specific campaign data through the existing campaign endpoint. Sample charts and fixed trend percentages have been removed from the dashboard.

## Request and response

```text
GET /api/google-ads/customer-accounts?connectionId=...
GET /api/google-ads/campaigns?connectionId=...&customerId=6803148513&dateRange=last_30_days
GET /api/google-ads/campaigns?connectionId=...&customerId=6803148513&dateRange=custom&startDate=2026-11-01&endDate=2026-11-15
```

The dated campaign response retains `success`, `connectionId`, `customerId`, and `campaigns`, and adds `dateRange`, `timeSeries`, and custom date boundaries when applicable. Requests without dates retain the previous response contract.

The corrected campaign-list GAQL is unchanged. Its transport now follows page tokens so larger accounts are not truncated. A separate daily reporting query supplies period metrics:

```sql
SELECT campaign.id, segments.date,
  metrics.impressions, metrics.clicks, metrics.interactions,
  metrics.cost_micros, metrics.conversions
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
ORDER BY segments.date, campaign.id
```

Preset ranges are allowlisted. Custom dates are validated as real ISO calendar dates with start <= end before interpolation. Daily reporting follows page tokens and replaces lifetime metrics with period aggregates, retaining campaign metadata and zero-activity campaigns from the original list. Reporting failures propagate rather than falling back to lifetime or sample data.

Date presets use Google's account-time-zone semantics; LAST_7_DAYS, LAST_14_DAYS and LAST_30_DAYS exclude today. The dashboard explains this next to the account time zone. See [Google Ads date ranges](https://developers.google.com/google-ads/api/docs/query/date-ranges) and [Google Ads pagination](https://developers.google.com/google-ads/api/docs/reporting/paging).

## Frontend behavior

- Account options come from the authorized customer-account endpoint, with actual customer IDs, names (or a customer-ID fallback), currencies and time zones. Manager accounts are excluded. OAuth identity IDs are not used as customer IDs.
- The current selection is retained while available; otherwise the preferred customer or first authorized customer is selected automatically.
- Account and date changes refresh the complete report. Abort signals, effect cleanup and selection-specific response validation prevent stale responses from replacing a newer selection. Connection changes and failed requests clear visible metrics.
- The dashboard consumes `response.campaigns`, converts micros to currency units and CTR fractions to percentages, and calculates weighted KPIs from actual period campaign totals. CPC = spend / clicks; CTR = clicks / impressions; conversion rate = conversions / interactions; cost per conversion = spend / conversions. Zero denominators produce zero, and fractional conversions are retained.
- Spend, clicks and conversion charts consume API daily points. Dates with no returned points are not fabricated. Empty reports show explicit empty states. Errors show an alert without displaying fabricated zero metrics. No mock performance or invented trends are displayed, including when development mock mode is enabled.
- Super Admin routing and backend authorization are unchanged. Clients still see only their assigned customer. No assignments, OAuth logic or client-profile linking was modified.

## Live verification

Live verification used the existing active assignment and connection, real account-authorization middleware, real campaign/customer routers and controllers, and live Google Ads API calls. The loopback-only test harness supplied a local test identity matching the existing assignment; it did not mint a NEXION token or test the production login/module-grant handshake. Access-token refresh stayed in process memory to avoid Firestore writes.

Authorized account returned:

```json
{
  "id": "6803148513",
  "name": "Customer 6803148513",
  "currency": "INR",
  "timeZone": "Asia/Calcutta"
}
```

| Check | Result |
| --- | --- |
| Authorized account discovery | HTTP 200; only customer 6803148513 returned |
| Original campaign endpoint without dates | HTTP 200; campaigns: [] |
| Today | HTTP 200; zero campaigns, zero KPIs, no daily points |
| Last 7 days | HTTP 200; zero campaigns, zero KPIs, no daily points |
| Last 14 days | HTTP 200; zero campaigns, zero KPIs, no daily points |
| Last 30 days | HTTP 200; zero campaigns, zero KPIs, no daily points |
| This month | HTTP 200; zero campaigns, zero KPIs, no daily points |
| Last month | HTTP 200; zero campaigns, zero KPIs, no daily points |
| Custom 2026-11-01 through 2026-11-15 | HTTP 200; zero campaigns, zero KPIs, no daily points |
| Client requests a different customer | HTTP 403; zero additional Google API calls |
| Client requests a different connection | HTTP 403; zero additional Google API calls |
| Invalid calendar date | HTTP 400 |
| Super Admin assigned-account campaign read | HTTP 200 |
| Super Admin campaign mutation | HTTP 403 |

Google request IDs for daily reports: today `OqjrZM2rPP_4ekyLRELPiA`, last 7 days `hbe0qlfg3UpWQCM838TCwQ`, last 14 days `72St10J5GAOhwl_fOzga8Q`, last 30 days `NamalI0d7RrddyuMHYR7WA`, this month `SDFx2qTuiSCeNQnkb5JaHg`, last month `eTgJ8GHuJ3o09Zo2JonG6A`, custom `9x0CpdkncQERWJD1NReQbw`.

The live account is empty and has only one authorized customer. Nonzero KPI/chart calculations, multiple-account switching, stale-response handling, and rendered states were therefore validated with regression fixtures rather than invented live data. An authenticated browser session was not available for an end-to-end visual check.

## Automated validation

- Backend `npm test`: 59 passed, including date validation, pagination, daily aggregation, error propagation, backward compatibility, and existing access restrictions.
- Frontend `npm test`: 8 passed, including real-data mapping, weighted KPIs, account/date switching, custom-date entry, stale-result rejection, empty/denied states, API request parameters, and server-rendered dashboard output.
- Frontend `npm run build`: passed.
- Frontend `git diff --check`: passed. Full backend/root check still reports the pre-existing trailing whitespace in `config/googleOAuth.js:7`; the OAuth file was left untouched as instructed. Changed integration files have no whitespace errors.

No OAuth reconnection, Firestore writes, assignment changes, client-profile changes, commits or deployment were performed.
