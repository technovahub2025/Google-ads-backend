# Google Ads Leads setup

This additive integration uses Google Ads Lead Form Webhook delivery. Google must be configured with:

- Webhook URL: `POST https://<public-nexion-google-ads-host>/api/google-ads/webhooks/leads`
- A unique confidential `google_key` for each configured form.
- The Google Ads lead-form webhook delivery method attached to the lead form asset.

Before delivery is enabled, a Super Admin must create a Firestore mapping through the authenticated API:

`POST /api/google-ads/lead-mappings`

```json
{
  "customerId": "1234567890",
  "formId": "987654321",
  "googleKey": "stored-server-side-only",
  "clientId": "CLT-000001",
  "companyId": "company-id",
  "connectionId": "google-ads-connection-id"
}
```

The mapping is checked against the connected Google Ads account and NEXION client company. Webhook deliveries are rejected until a unique key/form mapping exists. `lead_id` is the durable Firestore document key, so retries are acknowledged without duplicate records. Leads with no usable name and neither email nor phone are stored with `status: "review"`; no CRM contact is created automatically. Google Ads form submissions do not imply WhatsApp consent.

The authenticated UI endpoints are:

- `GET /api/google-ads/leads` with `connectionId`, `customerId`, `page`, `pageSize`, `search`, `status`, `campaignId`, `startDate`, and `endDate`.
- `PATCH /api/google-ads/leads/:leadId` with `status` and/or `assigneeId`.

