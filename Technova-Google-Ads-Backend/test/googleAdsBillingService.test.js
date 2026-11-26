const test = require("node:test");
const assert = require("node:assert/strict");
const { resolvePaymentArrangement } = require("../utils/googleAdsPaymentArrangement");
const { normalizeAvailableFunds, unavailableAvailableFunds } = require("../utils/googleAdsAvailableFunds");

const now = Date.parse("2026-11-26T00:00:00Z");

test("selects the current approved BillingSetup, not a historical setup", () => {
  const result = resolvePaymentArrangement({
    now,
    verifiedArrangement: "unknown",
    billingSetups: [
      { id: "old", status: "APPROVED", start_date_time: "2024-01-01 00:00:00", end_date_time: "2025-01-01 00:00:00" },
      { id: "current", status: "APPROVED", start_date_time: "2025-01-02 00:00:00", end_time_type: "FOREVER" },
    ],
  });

  assert.equal(result.paymentArrangement, "monthly_invoicing");
  assert.equal(result.billingSetup.id, "current");
  assert.equal(result.billingSetups.find((setup) => setup.id === "old").historical, true);
});

test("an explicitly verified prepaid arrangement overrides an approved setup", () => {
  const result = resolvePaymentArrangement({
    now,
    verifiedArrangement: "prepaid",
    billingSetups: [{ id: "current", status: "APPROVED", start_date_time: "2025-01-01 00:00:00", end_time_type: "FOREVER" }],
  });

  assert.equal(result.paymentArrangement, "prepaid");
  assert.equal(result.billingSetup.id, "current");
});

test("future and pending setups do not determine the current arrangement", () => {
  const result = resolvePaymentArrangement({
    now,
    verifiedArrangement: "unknown",
    billingSetups: [
      { id: "future", status: "APPROVED", start_date_time: "2027-01-01 00:00:00" },
      { id: "pending", status: "PENDING", start_date_time: "2026-01-01 00:00:00" },
    ],
  });

  assert.equal(result.paymentArrangement, "unknown");
  assert.equal(result.billingSetup, null);
});

test("normalizes a confirmed available balance, including zero", () => {
  assert.deepEqual(normalizeAvailableFunds({ amountMicros: "500000000", currency: "INR" }), {
    status: "available", amount: 500, currency: "INR",
  });
  assert.deepEqual(normalizeAvailableFunds({ amountMicros: "0", currency: "INR" }), {
    status: "available", amount: 0, currency: "INR",
  });
});

test("does not turn a missing balance into zero", () => {
  assert.deepEqual(normalizeAvailableFunds({ currency: "INR" }), unavailableAvailableFunds("INR"));
});
