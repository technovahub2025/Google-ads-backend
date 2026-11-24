const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const id = (value, label = 'Resource ID') => /^\d+$/.test(String(value || '')) ? String(value) : fail(`${label} must contain digits only`);
const text = (value, label, max = 128) => typeof value === 'string' && value.trim() && [...value.trim()].length <= max ? value.trim() : fail(`${label} is required (maximum ${max} characters)`);
const micros = (value) => {
  const amount = String(value ?? '');
  if (!/^\d+(?:\.\d{1,6})?$/.test(amount)) fail('Amount must be positive with at most six decimal places');
  const [whole, decimal = ''] = amount.split('.');
  const result = BigInt(whole) * 1000000n + BigInt(decimal.padEnd(6, '0'));
  if (result <= 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) fail('Amount is outside the supported range');
  return result.toString();
};
const state = (value) => ['PAUSED', 'ENABLED'].includes(value) ? value : fail('Status must be PAUSED or ENABLED');
const isoDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('Dates must be valid YYYY-MM-DD calendar dates');
  return value;
};
const dates = (input, clearEnd = false) => {
  const result = {};
  if (input.startDate) result.startDateTime = `${isoDate(input.startDate)} 00:00:00`;
  if (input.endDate) result.endDateTime = `${isoDate(input.endDate)} 23:59:59`;
  if (clearEnd && input.endDate === '') result.endDateTime = '';
  if (result.startDateTime && result.endDateTime && result.startDateTime > result.endDateTime) fail('End date must be on or after start date');
  return result;
};
module.exports = { fail, id, text, micros, state, dates };
