const { getCustomerAccount } = require("./googleAdsCustomerService");

const reconnectRequired = (error) => error.diagnostic?.googleAdsErrorCode === "RECONNECT_REQUIRED";
const arrangements = new Set(["prepaid", "monthly_invoicing", "automatic_payments"]);
const verificationMaxAgeMs = 7 * 24 * 60 * 60 * 1000;

function verifiedPaymentArrangement(customerId) {
  // An authorized operator verifies "How you pay" in Google Ads Billing Settings.
  // API invoice setups and account budgets can also appear on a Prepay account.
  // Server configuration is keyed by the 10-digit advertiser ID with a UTC verifiedAt timestamp.
  let records;
  try {
    records = JSON.parse(process.env.GOOGLE_ADS_VERIFIED_PAYMENT_ARRANGEMENTS || "{}");
  } catch {
    return "unknown";
  }
  const { paymentArrangement, verifiedAt } = records?.[customerId] || {};
  if (!arrangements.has(paymentArrangement) || typeof verifiedAt !== "string") return "unknown";
  const verified = new Date(verifiedAt);
  if (!Number.isFinite(verified.getTime()) || verified.toISOString() !== verifiedAt) return "unknown";
  const age = Date.now() - verified.getTime();
  return age >= 0 && age < verificationMaxAgeMs ? paymentArrangement : "unknown";
}

async function getGoogleAdsBilling({ connectionId, customerId, managerCustomerId }) {
  const { customer } = await getCustomerAccount({ connectionId, customerId, managerCustomerId }) || {};
  if (!customer?.id) throw new Error("Google Ads did not verify the assigned customer.");
  if (customer.manager === true) {
    throw Object.assign(new Error("The assigned account is a Google Ads manager account."), { code: "BILLING_ACCOUNT_ACCESS_DENIED" });
  }

  const account = { customerId, name: customer.descriptive_name || null, currency: customer.currency_code || null };
  const paymentArrangement = verifiedPaymentArrangement(customerId);
  return {
    account, connectionStatus: "connected", paymentArrangement,
    arrangement: paymentArrangement,
    ...(paymentArrangement === "unknown" ? { billingDetailsUnavailable: true } : {}),
  };
}

module.exports = { getGoogleAdsBilling, reconnectRequired };
