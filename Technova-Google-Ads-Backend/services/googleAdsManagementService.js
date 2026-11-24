const { requestGoogleAdsApi, normalizeCustomerId, decamelizeKeys } = require('./googleAdsApiClient');
const { getGoogleAdsConnection } = require('../model/GoogleAdsConnection');

const { fail, id, text, micros, state, dates } = require('./googleAdsManagementFields');
const { createPerformanceMax, performanceMaxOptions } = require('./googleAdsPerformanceMaxService');

const context = async (input) => {
  const customerId = normalizeCustomerId(input.customerId);
  const connection = await getGoogleAdsConnection(input.connectionId);
  if (!connection?.connected || !connection.refreshToken) fail('An active Google Ads connection is required', 404);
  return { connectionId: input.connectionId, customerId, managerCustomerId: connection.managerCustomerId };
};
const search = async (ctx, query) => {
  const rows = []; let pageToken;
  do {
    const response = await requestGoogleAdsApi({ ...ctx, operation: 'management_list', endpoint: '/customers/:customerId/googleAds:search', method: 'POST', operationKind: 'read', retryPolicy: 'safe', body: { query, ...(pageToken ? { pageToken } : {}) } });
    rows.push(...decamelizeKeys(response.results || [])); pageToken = response.nextPageToken;
  } while (pageToken);
  return rows;
};
const mutate = async (ctx, resource, operations) => {
  const response = await requestGoogleAdsApi({ ...ctx, operation: `${resource}_mutate`, endpoint: `/customers/:customerId/${resource}:mutate`, method: 'POST', operationKind: 'mutation', retryPolicy: 'never', body: { operations, partialFailure: false } });
  if (response.partialFailureError || !response.results?.length || response.results.some((item) => !item.resourceName)) fail('Google Ads did not confirm the mutation. Refresh before retrying.', 502);
  return { success: true, created: Boolean(operations[0].create), resourceName: response.results[0].resourceName, message: 'Google Ads change confirmed', results: response.results };
};
const rn = (ctx, collection, resourceId) => `customers/${ctx.customerId}/${collection}/${id(resourceId)}`;
const update = (ctx, resource, resourceName, fields, mask) => mutate(ctx, resource, [{ update: { resourceName, ...fields }, updateMask: mask }]);
const campaign = async (ctx, campaignId, searchOnly = false) => {
  const [row] = await search(ctx, `SELECT campaign.id, campaign.advertising_channel_type, campaign.bidding_strategy_type FROM campaign WHERE campaign.id = ${id(campaignId)} AND campaign.status != 'REMOVED'`);
  if (!row) fail('Campaign not found in the selected customer', 404);
  if (searchOnly && row.campaign.advertising_channel_type !== 'SEARCH') fail('Creation is supported only for Search campaigns');
  return row.campaign;
};
const manageableCampaign = async (ctx, campaignId) => {
  const existing = await campaign(ctx, campaignId);
  if (!['SEARCH', 'PERFORMANCE_MAX'].includes(existing.advertising_channel_type)) fail('This campaign type cannot change status or be removed here');
};
const group = async (ctx, adGroupId) => {
  const [row] = await search(ctx, `SELECT ad_group.id, ad_group.type, campaign.id, campaign.advertising_channel_type, campaign.bidding_strategy_type FROM ad_group WHERE ad_group.id = ${id(adGroupId)} AND ad_group.status != 'REMOVED'`);
  if (!row) fail('Ad group not found in the selected customer', 404);
  if (row.campaign.advertising_channel_type !== 'SEARCH' || row.ad_group.type !== 'SEARCH_STANDARD') fail('This action requires a standard Search ad group');
  return row;
};
const QUERIES = {
  campaigns: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.start_date_time, campaign.end_date_time, campaign.campaign_budget, campaign_budget.id, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id`,
  budgets: `SELECT campaign_budget.id, campaign_budget.name, campaign_budget.status, campaign_budget.period, campaign_budget.amount_micros, campaign_budget.total_amount_micros, campaign_budget.delivery_method FROM campaign_budget WHERE campaign_budget.status != 'REMOVED'`,
  adGroups: `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros, campaign.id, campaign.name, campaign.advertising_channel_type, campaign.bidding_strategy_type FROM ad_group WHERE ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'`,
  ads: `SELECT ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.status, ad_group.id, ad_group.name, campaign.id, campaign.name, campaign.advertising_channel_type FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' AND ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'`,
  keywords: `SELECT ad_group_criterion.criterion_id, ad_group_criterion.status, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group.id, ad_group.name, campaign.id, campaign.name FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED' AND campaign.advertising_channel_type = 'SEARCH' AND campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED'`,
};
const list = async (kind, input) => ({ success: true, data: await search(await context(input), QUERIES[kind]) });

const createCampaign = (input) => createPerformanceMax(input, { context, search });
const campaignCreationOptions = (input) => performanceMaxOptions(input, { context, search });
const editCampaign = async (input) => {
  const ctx = await context(input); await campaign(ctx, input.campaignId, true);
  const fields = { name: text(input.name, 'Campaign name'), ...dates(input, true) };
  if (input.budgetId) fields.campaignBudget = rn(ctx, 'campaignBudgets', input.budgetId);
  return update(ctx, 'campaigns', rn(ctx, 'campaigns', input.campaignId), fields, ['name', ...(fields.startDateTime ? ['start_date_time'] : []), ...(Object.hasOwn(fields, 'endDateTime') ? ['end_date_time'] : []), ...(fields.campaignBudget ? ['campaign_budget'] : [])].join(','));
};
const updateCampaignStatus = async (input) => {
  const status = state(input.status), ctx = await context(input);
  await manageableCampaign(ctx, input.campaignId);
  return update(ctx, 'campaigns', rn(ctx, 'campaigns', input.campaignId), { status }, 'status');
};
const createCampaignBudget = async (input) => {
  const amountMicros = micros(input.budgetAmount), name = text(input.name, 'Budget name');
  if (input.period && input.period !== 'DAILY') fail('Only daily budget creation is supported');
  return mutate(await context(input), 'campaignBudgets', [{ create: { name, amountMicros, deliveryMethod: 'STANDARD', explicitlyShared: true } }]);
};
const editCampaignBudget = async (input) => {
  const amountMicros = micros(input.budgetAmount), ctx = await context(input);
  const [row] = await search(ctx, `SELECT campaign_budget.id, campaign_budget.period FROM campaign_budget WHERE campaign_budget.id = ${id(input.budgetId)} AND campaign_budget.status != 'REMOVED'`);
  if (!row || row.campaign_budget.period !== 'DAILY') fail('Only existing daily budgets can be edited');
  return update(ctx, 'campaignBudgets', rn(ctx, 'campaignBudgets', input.budgetId), { amountMicros }, 'amount_micros');
};
const budgetInUseCode = 'CAMPAIGN_BUDGET_IN_USE';
const budgetInUse = async (ctx, budgetId, resourceName, error) => {
  let campaigns = [];
  try {
    const rows = await search(ctx, `SELECT campaign.id, campaign.name FROM campaign WHERE campaign.campaign_budget = '${resourceName}' AND campaign.status IN ('ENABLED', 'PAUSED') ORDER BY campaign.id LIMIT 10`);
    campaigns = rows.map(({ campaign }) => ({ id: String(campaign.id), name: campaign.name || '' }));
  } catch {
    // The association is already confirmed. Missing names must not hide the conflict.
  }
  const names = campaigns.map(({ name, id }) => name ? `“${name}”` : `ID ${id}`);
  const message = 'This budget is assigned to one or more campaigns and cannot be deleted.'
    + (names.length ? ` Campaigns using it include ${names.join(', ')}.` : '');
  return Object.assign(new Error(message), {
    status: 409, code: budgetInUseCode, budgetId, campaigns, diagnosticId: error?.diagnosticId,
  });
};
const deleteCampaignBudget = async (input) => {
  const ctx = await context(input);
  const budgetId = id(input.budgetId);
  const resourceName = rn(ctx, 'campaignBudgets', budgetId);
  const [row] = await search(ctx, `SELECT campaign_budget.reference_count FROM campaign_budget WHERE campaign_budget.id = ${budgetId} AND campaign_budget.status != 'REMOVED'`);
  if (!row?.campaign_budget) fail('Budget not found in the selected customer', 404);
  const count = Number(row.campaign_budget.reference_count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) fail('Google Ads could not confirm whether the budget is in use.', 502);
  if (count > 0) throw await budgetInUse(ctx, budgetId, resourceName);
  try {
    return await mutate(ctx, 'campaignBudgets', [{ remove: resourceName }]);
  } catch (error) {
    const diagnostic = error.diagnostic;
    const hasBudgetError = diagnostic?.googleAdsErrorCode?.split(',').some((code) => code.split('.').at(-1) === budgetInUseCode)
      || diagnostic?.googleAdsErrorDetails?.some(({ errorCode }) =>
        (errorCode?.campaignBudgetError ?? errorCode?.campaign_budget_error) === budgetInUseCode);
    if (!hasBudgetError) throw error;
    throw await budgetInUse(ctx, budgetId, resourceName, error);
  }
};
const createAdGroup = async (input) => {
  const name = text(input.name, 'Ad group name'), cpcBidMicros = micros(input.cpcBid), ctx = await context(input);
  const parent = await campaign(ctx, input.campaignId, true);
  if (parent.bidding_strategy_type !== 'MANUAL_CPC') fail('New ad groups currently require a Manual CPC Search campaign');
  return mutate(ctx, 'adGroups', [{ create: { name, campaign: rn(ctx, 'campaigns', input.campaignId), type: 'SEARCH_STANDARD', status: 'PAUSED', cpcBidMicros } }]);
};
const editAdGroup = async (input) => {
  const ctx = await context(input); const parent = await group(ctx, input.adGroupId);
  if (input.status) return update(ctx, 'adGroups', rn(ctx, 'adGroups', input.adGroupId), { status: state(input.status) }, 'status');
  const fields = { name: text(input.name, 'Ad group name') }; const mask = ['name'];
  if (input.cpcBid !== undefined && input.cpcBid !== '') {
    if (parent.campaign.bidding_strategy_type !== 'MANUAL_CPC') fail('CPC bids are supported only with Manual CPC bidding');
    fields.cpcBidMicros = micros(input.cpcBid); mask.push('cpc_bid_micros');
  }
  return update(ctx, 'adGroups', rn(ctx, 'adGroups', input.adGroupId), fields, mask.join(','));
};
const assets = (values, label, min, max, length) => {
  if (!Array.isArray(values) || values.length < min || values.length > max) fail(`${label} requires ${min}–${max} unique entries`);
  const result = values.map((value) => text(value, label, length));
  if (new Set(result).size !== result.length) fail(`${label} must be unique`);
  return result.map((value) => ({ text: value }));
};
const adContent = (input) => {
  let url; try { url = new URL(input.finalUrl); } catch { fail('A valid final URL is required'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('Final URL must use HTTP(S) without embedded credentials');
  return { finalUrls: [url.href], responsiveSearchAd: { headlines: assets(input.headlines, 'Headlines', 3, 15, 30), descriptions: assets(input.descriptions, 'Descriptions', 2, 4, 90) } };
};
const createAd = async (input) => {
  const content = adContent(input), ctx = await context(input); await group(ctx, input.adGroupId);
  return mutate(ctx, 'adGroupAds', [{ create: { adGroup: rn(ctx, 'adGroups', input.adGroupId), status: 'PAUSED', ad: content } }]);
};
const existingAd = async (ctx, input) => {
  await group(ctx, input.adGroupId);
  const [row] = await search(ctx, `SELECT ad_group_ad.ad.id, ad_group_ad.ad.type FROM ad_group_ad WHERE ad_group.id = ${id(input.adGroupId)} AND ad_group_ad.ad.id = ${id(input.adId)} AND ad_group_ad.status != 'REMOVED'`);
  if (!row || row.ad_group_ad.ad.type !== 'RESPONSIVE_SEARCH_AD') fail('Select a responsive search ad in this customer and ad group');
};
const editAd = async (input) => {
  const ctx = await context(input); await existingAd(ctx, input);
  if (input.status) return update(ctx, 'adGroupAds', `customers/${ctx.customerId}/adGroupAds/${id(input.adGroupId)}~${id(input.adId)}`, { status: state(input.status) }, 'status');
  return update(ctx, 'ads', rn(ctx, 'ads', input.adId), adContent(input), 'final_urls,responsive_search_ad.headlines,responsive_search_ad.descriptions');
};
const createKeyword = async (input) => {
  const keyword = text(input.keyword, 'Keyword', 80);
  if (!['EXACT', 'PHRASE', 'BROAD'].includes(input.matchType)) fail('Match type must be EXACT, PHRASE or BROAD');
  const ctx = await context(input); await group(ctx, input.adGroupId);
  return mutate(ctx, 'adGroupCriteria', [{ create: { adGroup: rn(ctx, 'adGroups', input.adGroupId), status: 'PAUSED', keyword: { text: keyword, matchType: input.matchType } } }]);
};
const editKeyword = async (input) => {
  if (input.keyword || input.matchType) fail('Keyword text and match type are immutable; remove and recreate the keyword');
  const ctx = await context(input); await group(ctx, input.adGroupId);
  return update(ctx, 'adGroupCriteria', `customers/${ctx.customerId}/adGroupCriteria/${id(input.adGroupId)}~${id(input.keywordId)}`, { status: state(input.status) }, 'status');
};
const remove = async (kind, input) => {
  const ctx = await context(input);
  const resource = { campaign: ['campaigns', input.campaignId], group: ['adGroups', input.adGroupId], ad: ['adGroupAds'], keyword: ['adGroupCriteria'] }[kind];
  if (kind === 'campaign') await manageableCampaign(ctx, input.campaignId);
  if (kind === 'group' || kind === 'keyword') await group(ctx, input.adGroupId);
  if (kind === 'ad') await existingAd(ctx, input);
  const resourceName = ['ad', 'keyword'].includes(kind) ? `customers/${ctx.customerId}/${resource[0]}/${id(input.adGroupId)}~${id(kind === 'ad' ? input.adId : input.keywordId)}` : rn(ctx, ...resource);
  return mutate(ctx, resource[0], [{ remove: resourceName }]);
};

module.exports = { list, createCampaign, campaignCreationOptions, editCampaign, updateCampaignStatus, createCampaignBudget, editCampaignBudget, createAdGroup, editAdGroup, createAd, editAd, createKeyword, editKeyword,
  deleteCampaign: (input) => remove('campaign', input), deleteCampaignBudget, deleteAdGroup: (input) => remove('group', input), deleteAd: (input) => remove('ad', input), deleteKeyword: (input) => remove('keyword', input), micros, adContent, QUERIES };
