function unavailableAvailableFunds(currency, reason = "Google Ads API does not expose the account's prepaid available-funds balance") {
  return { status: "unavailable", amount: null, currency: currency || null, reason };
}

function normalizeAvailableFunds({ amountMicros, currency } = {}) {
  if (amountMicros === null || amountMicros === undefined || amountMicros === "") return unavailableAvailableFunds(currency);
  const amount = Number(amountMicros);
  if (!Number.isFinite(amount)) return unavailableAvailableFunds(currency);
  return { status: "available", amount: amount / 1_000_000, currency: currency || null };
}

module.exports = { normalizeAvailableFunds, unavailableAvailableFunds };
