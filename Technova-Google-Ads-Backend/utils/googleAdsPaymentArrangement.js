const arrangements = new Set(["prepaid", "monthly_invoicing", "automatic_payments"]);
const approvedBillingSetupStatuses = new Set(["APPROVED", "APPROVED_HELD"]);

function resolvePaymentArrangement({ billingSetups = [], verifiedArrangement = "unknown" }) {
  // BillingSetup is the Google Ads API's authoritative signal for monthly
  // invoicing. Prepaid and automatic payments are not represented by the
  // BillingSetup resource, so those values require an explicit, recent
  // verification from Google Ads Billing settings.
  const approvedSetup = billingSetups.find((setup) => approvedBillingSetupStatuses.has(String(setup?.status || "").toUpperCase()));
  if (approvedSetup) return { paymentArrangement: "monthly_invoicing", source: "billing_setup", billingSetup: approvedSetup };
  if (arrangements.has(verifiedArrangement)) return { paymentArrangement: verifiedArrangement, source: "google_ads_manual_verification", billingSetup: null };
  return { paymentArrangement: "unknown", source: "unverified", billingSetup: null };
}

module.exports = { resolvePaymentArrangement };
