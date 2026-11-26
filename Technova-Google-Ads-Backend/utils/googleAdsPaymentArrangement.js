const arrangements = new Set(["prepaid", "monthly_invoicing", "automatic_payments"]);
const approvedBillingSetupStatuses = new Set(["APPROVED", "APPROVED_HELD"]);

const parseGoogleDate = (value) => {
  if (!value) return null;
  const text = String(value).replace(" ", "T");
  const timestamp = Date.parse(text + (text.includes("Z") ? "" : "Z"));
  return Number.isFinite(timestamp) ? timestamp : null;
};

function evaluateBillingSetup(setup, now = Date.now()) {
  const status = String(setup?.status || "").toUpperCase();
  const start = parseGoogleDate(setup?.start_date_time);
  const end = parseGoogleDate(setup?.end_date_time);
  const approved = approvedBillingSetupStatuses.has(status);
  const started = start === null || start <= now;
  const notEnded = end === null || end > now;
  return { ...setup, status, approved, active: approved && started && notEnded,
    historical: approved && end !== null && end <= now,
    future: approved && start !== null && start > now };
}

function resolvePaymentArrangement({ billingSetups = [], verifiedArrangement = "unknown", now = Date.now() }) {
  const evaluatedBillingSetups = billingSetups.map((setup) => evaluateBillingSetup(setup, now));
  const selectedBillingSetup = evaluatedBillingSetups
    .filter((setup) => setup.active)
    .sort((left, right) => (parseGoogleDate(right.start_date_time) || 0) - (parseGoogleDate(left.start_date_time) || 0))[0] || null;

  // Billing Settings is the stronger signal for prepaid and automatic
  // payments because BillingSetup does not contain a payment-method field.
  if (arrangements.has(verifiedArrangement)) return { paymentArrangement: verifiedArrangement, source: "google_ads_manual_verification", billingSetup: selectedBillingSetup, billingSetups: evaluatedBillingSetups };
  if (selectedBillingSetup) return { paymentArrangement: "monthly_invoicing", source: "billing_setup", billingSetup: selectedBillingSetup, billingSetups: evaluatedBillingSetups };
  return { paymentArrangement: "unknown", source: "unverified", billingSetup: null, billingSetups: evaluatedBillingSetups };
}

module.exports = { evaluateBillingSetup, resolvePaymentArrangement };
