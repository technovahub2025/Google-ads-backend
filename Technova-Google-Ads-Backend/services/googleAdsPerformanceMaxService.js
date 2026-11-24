
const { createHash, randomUUID } = require('node:crypto');
const { requestGoogleAdsApi } = require('./googleAdsApiClient');
const { fail, text } = require('./googleAdsManagementFields');
const { validatePerformanceMax } = require('./googleAdsPerformanceMaxValidation');

const optionQueries = {
  conversionCustomer: 'SELECT customer.conversion_tracking_setting.google_ads_conversion_customer FROM customer',
  languages: 'SELECT language_constant.id, language_constant.name FROM language_constant WHERE language_constant.targetable = true ORDER BY language_constant.name',
  actions: 'SELECT conversion_action.resource_name, conversion_action.name, conversion_action.status, conversion_action.category, conversion_action.origin, conversion_action.primary_for_goal FROM conversion_action',
  goals: 'SELECT customer_conversion_goal.category, customer_conversion_goal.origin, customer_conversion_goal.biddable FROM customer_conversion_goal',
  audiences: "SELECT audience.resource_name, audience.name FROM audience WHERE audience.status = 'ENABLED' AND audience.scope != 'ASSET_GROUP'",
  lists: "SELECT user_list.resource_name, user_list.name, user_list.type FROM user_list WHERE user_list.eligible_for_display = true AND user_list.membership_status = 'OPEN' AND user_list.account_user_list_status = 'ENABLED'",
  custom: "SELECT custom_audience.resource_name, custom_audience.name FROM custom_audience WHERE custom_audience.status = 'ENABLED'",
};

const goalKey = (goal) => goal.category + '~' + goal.origin;
const read = (ctx, dependencies, key) => dependencies.search(ctx, optionQueries[key]);

async function conversionOptions(ctx, dependencies) {
  const [goalRows, [account]] = await Promise.all([read(ctx, dependencies, 'goals'), read(ctx, dependencies, 'conversionCustomer')]);
  const conversionOwner = account?.customer?.conversion_tracking_setting?.google_ads_conversion_customer;
  const ownerId = /^customers\/(\d{10})$/.exec(conversionOwner || '')?.[1] || ctx.customerId;
  const canSelectActions = ownerId === ctx.customerId;
  const goals = goalRows.map(({ customer_conversion_goal: goal }) => ({ ...goal, key: goalKey(goal) }));
  const goalKeys = new Set(goals.map((goal) => goal.key));
  // Cross-account tracking may use manager-owned actions. Limit returned actions
  // to categories and origins shared with the authorized serving customer.
  const actions = await read({ ...ctx, customerId: ownerId }, dependencies, 'actions');
  return {
    goals, canSelectActions,
    actions: actions.filter(({ conversion_action: action }) => canSelectActions || goalKeys.has(goalKey(action)))
      .map(({ conversion_action: action }) => ({
        id: action.resource_name, name: action.name, status: action.status,
        category: action.category, origin: action.origin, goalKey: goalKey(action),
        primary: Boolean(action.primary_for_goal),
      })),
  };
}

async function audienceOptions(ctx, dependencies) {
  const methods = [
    ['audiences', 'audience', () => 'Saved audience'],
    ['lists', 'user_list', (row) => row.type === 'CRM_BASED' ? 'Customer list' : row.type === 'RULE_BASED' ? 'Rule-based list (including website visitors)' : 'Remarketing list'],
    ['custom', 'custom_audience', () => 'Custom segment'],
  ];
  const responses = await Promise.allSettled(methods.map(([key]) => read(ctx, dependencies, key)));
  const options = [];
  const unavailable = [];
  for (const [index, response] of responses.entries()) {
    const [key, field, label] = methods[index];
    if (response.status === 'rejected') {
      unavailable.push(key);
      continue;
    }
    for (const { [field]: row } of response.value) {
      options.push({ id: row.resource_name, name: row.name, category: label(row), type: key });
    }
  }
  return { options: options.sort((a, b) => a.name.localeCompare(b.name)), unavailable };
}

async function performanceMaxOptions(input, dependencies) {
  const ctx = await dependencies.context(input);
  switch (input.kind) {
    case 'languages':
      return (await read(ctx, dependencies, 'languages')).map(({ language_constant: language }) => ({
        id: String(language.id), name: language.name,
      }));
    case 'locations': {
      const term = text(input.q, 'Location search', 80);
      if (term.length < 2) fail('Enter at least two characters');
      const result = await requestGoogleAdsApi({
        ...ctx, endpoint: '/geoTargetConstants:suggest', operation: 'pmax_location_search',
        method: 'POST', operationKind: 'read', retryPolicy: 'safe',
        body: { locale: 'en', locationNames: { names: [term] } },
      });
      return (result.geoTargetConstantSuggestions || []).map(({ geoTargetConstant: location }) => location)
        .filter((location) => location.status === 'ENABLED')
        .slice(0, 40)
        .map((location) => ({ id: location.resourceName.split('/').pop(), name: location.canonicalName || location.name, type: location.targetType }));
    }
    case 'goals':
      return conversionOptions(ctx, dependencies);
    case 'audiences':
      return audienceOptions(ctx, dependencies);
    default:
      fail('Unknown campaign creation options');
  }
}

const isPrimary = (action) => action.status === 'ENABLED' && action.primary;
const isCustomGoalResource = (ctx, resource) =>
  /^customers\/(\d{10})\/customConversionGoals\/[1-9]\d*$/.exec(resource)?.[1] === ctx.customerId;

async function findCustomConversionGoal(ctx, dependencies, conversionActions) {
  const rows = await dependencies.search(ctx, `
    SELECT custom_conversion_goal.resource_name, custom_conversion_goal.conversion_actions
    FROM custom_conversion_goal
    WHERE custom_conversion_goal.status = 'ENABLED'
  `);
  const match = rows.find(({ custom_conversion_goal: goal }) => {
    const actions = new Set(goal.conversion_actions);
    return isCustomGoalResource(ctx, goal.resource_name) && actions.size === conversionActions.length &&
      conversionActions.every((action) => actions.has(action));
  });
  return match?.custom_conversion_goal.resource_name;
}

function reportGoogleAdsError(error) {
  const detail = error.diagnostic?.googleAdsErrorDetails?.[0];
  if (detail?.errorCode) {
    const codes = Object.values(detail.errorCode).filter((code) => typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code));
    if (codes.length) error.message += ' Google Ads error: ' + codes.join(', ') + '.';
  }
  return error;
}

async function mutateGoals(ctx, resource, operations) {
  const result = await requestGoogleAdsApi({
    ...ctx, operation: 'performance_max_' + resource, endpoint: `/customers/:customerId/${resource}:mutate`,
    method: 'POST', operationKind: 'mutation', retryPolicy: 'never', body: { operations },
  });
  if (result.partialFailureError || result.results?.length !== operations.length ||
      result.results.some((item, index) => !item.resourceName ||
        (operations[index].update && item.resourceName !== operations[index].update.resourceName))) {
    fail('Google Ads did not confirm the conversion goal operation.', 502);
  }
  return result.results;
}

async function resolveCustomConversionGoal(ctx, dependencies, draft) {
  const existing = await findCustomConversionGoal(ctx, dependencies, draft.conversionActions);
  if (existing) return existing;

  try {
    const [created] = await mutateGoals(ctx, 'customConversionGoals', [{ create: {
      name: [...draft.name].slice(0, 90).join('') + ' - ' + randomUUID().slice(0, 8),
      conversionActions: draft.conversionActions,
    } }]);
    if (!isCustomGoalResource(ctx, created.resourceName)) fail('Google Ads returned an invalid custom goal reference.', 502);
    return created.resourceName;
  } catch (error) {
    const duplicate = error.diagnostic?.googleAdsErrorDetails?.some((detail) =>
      detail.errorCode?.customConversionGoalError === 'DUPLICATE_CONVERSION_ACTION_LIST');
    if (duplicate) {
      const concurrent = await findCustomConversionGoal(ctx, dependencies, draft.conversionActions);
      if (concurrent) return concurrent;
    }
    throw reportGoogleAdsError(error);
  }
}

async function configureCampaignGoals(ctx, dependencies, campaignId, selectedGoals, customGoal, customerGoalKeys) {
  const base = `customers/${ctx.customerId}/`;
  const prefix = `${base}campaignConversionGoals/${campaignId}~`;
  const query = `SELECT campaign_conversion_goal.resource_name, campaign_conversion_goal.category,
    campaign_conversion_goal.origin, campaign_conversion_goal.biddable
    FROM campaign_conversion_goal WHERE campaign.id = ${campaignId}`;
  const goals = new Map();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, attempt * 350));
    goals.clear();
    for (const { campaign_conversion_goal: goal } of await dependencies.search(ctx, query)) {
      const key = goalKey(goal);
      if (goal.resource_name !== prefix + key) fail('Google Ads returned an invalid campaign goal reference.', 502);
      goals.set(key, goal);
    }
    if (customerGoalKeys.every((key) => goals.has(key))) break;
  }
  if (customerGoalKeys.some((key) => !goals.has(key))) fail('Google Ads did not return all of the new campaign’s conversion goals.', 502);
  if (!customGoal && (!selectedGoals.length || selectedGoals.some((key) => !goals.has(key)))) {
    fail('Select at least one available campaign conversion goal.');
  }

  if (customGoal) {
    await mutateGoals(ctx, 'conversionGoalCampaignConfigs', [{
      update: { resourceName: `${base}conversionGoalCampaignConfigs/${campaignId}`, customConversionGoal: customGoal },
      updateMask: 'custom_conversion_goal',
    }]);
  }

  const update = (goal, biddable) => ({ update: { resourceName: goal.resource_name, biddable }, updateMask: 'biddable' });
  // Setting a selected goal biddable also switches the campaign to campaign-level goals.
  const selected = new Set(selectedGoals);
  const operations = selectedGoals.map((key) => update(goals.get(key), true));
  for (const [key, goal] of goals) {
    if (!selected.has(key) && goal.biddable) operations.push(update(goal, false));
  }
  // In action mode the confirmed custom goal stays active while standard goals are disabled.
  if (operations.length) await mutateGoals(ctx, 'campaignConversionGoals', operations);
}

function buildOperations(ctx, input, draft, audienceCatalog) {
  const base = 'customers/' + ctx.customerId + '/';
  const operations = [];
  let nextId = -1;
  const temporary = (collection) => base + collection + '/' + nextId--;
  const create = (type, resource) => operations.push({ [type + 'Operation']: { create: resource } });
  const budget = temporary('campaignBudgets');
  const campaign = temporary('campaigns');
  const budgetSuffix = ' PMax ' + randomUUID().slice(0, 8);
  create('campaignBudget', {
    resourceName: budget, name: [...draft.name].slice(0, 128 - budgetSuffix.length).join('') + budgetSuffix,
    amountMicros: draft.amountMicros, deliveryMethod: 'STANDARD', explicitlyShared: false,
  });

  const assetNames = new Map();
  function youtubeAssetName(groupName, videoId) {
    const suffix = ' - ' + groupName + ' - YouTube ' + videoId;
    // Asset names are limited to 255 characters. Both campaign and group names
    // have already been validated as non-empty, so this is always meaningful.
    return [...draft.name].slice(0, 255 - [...suffix].length).join('') + suffix;
  }
  function imageAssetName(groupName, fieldType, key) {
    // A name is required when Google resolves an image against an existing
    // unnamed ImageAsset. The digest keeps names stable, unique, and free of
    // submitted image content while remaining within Asset.name's 255 limit.
    const suffix = ' - ' + groupName + ' - ' + fieldType + ' - ' + key.slice(0, 16);
    return [...draft.name].slice(0, 255 - [...suffix].length).join('') + suffix;
  }
  function prepareAssets(assets, groupName) {
    return assets.map(({ fieldType, content }) => {
      const key = createHash('sha256').update(JSON.stringify(content)).digest('hex');
      if (!assetNames.has(key)) {
        const asset = temporary('assets');
        assetNames.set(key, asset);
        const videoId = content.youtubeVideoAsset?.youtubeVideoId;
        const name = videoId
          ? youtubeAssetName(groupName, videoId)
          : content.imageAsset ? imageAssetName(groupName, fieldType, key) : '';
        // Text assets do not receive names. ImageAsset and YoutubeVideoAsset
        // do: Google Ads v25 requires one when it resolves matching assets.
        create('asset', { resourceName: asset, ...(name ? { name } : {}), ...content });
      }
      return { fieldType, asset: assetNames.get(key) };
    });
  }
  const brandLinks = prepareAssets(draft.brand, 'Brand');
  const groups = draft.groups.map((group) => ({
    ...group, resourceName: temporary('assetGroups'), links: prepareAssets(group.assets, group.name),
  }));
  // Google requires brand links to immediately follow campaign creation.
  create('campaign', {
    resourceName: campaign, name: draft.name, status: 'PAUSED',
    advertisingChannelType: 'PERFORMANCE_MAX', campaignBudget: budget,
    brandGuidelinesEnabled: true, containsEuPoliticalAdvertising: input.euPoliticalAdvertising,
    ...(Object.keys(draft.brandGuidelines).length ? { brandGuidelines: draft.brandGuidelines } : {}),
    geoTargetTypeSetting: { positiveGeoTargetType: input.locationMode },
    assetAutomationSettings: [{
      assetAutomationType: 'FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION',
      assetAutomationStatus: input.urlExpansion ? 'OPTED_IN' : 'OPTED_OUT',
    }],
    ...(draft.finalUrlSuffix ? { finalUrlSuffix: draft.finalUrlSuffix } : {}),
    ...draft.schedule, ...draft.bidding,
  });
  for (const link of brandLinks) create('campaignAsset', { campaign, ...link });

  for (const group of groups) {
    if (!group.segments.length) continue;
    group.audience = temporary('audiences');
    create('audience', {
      resourceName: group.audience, scope: 'CUSTOMER',
      name: [...group.name].slice(0, 128).join('') + ' - NEXION ' + randomUUID(),
      dimensions: [{ audienceSegments: { segments: group.segments.map((segment) => {
        const source = audienceCatalog.get(segment);
        const field = source.type === 'lists' ? 'userList' : 'customAudience';
        return { [field]: { [field]: segment } };
      }) } }],
    });
  }

  for (const group of groups) {
    create('assetGroup', {
      resourceName: group.resourceName, campaign, name: group.name,
      finalUrls: [group.finalUrl], status: 'ENABLED',
    });
    for (const link of group.links) create('assetGroupAsset', { assetGroup: group.resourceName, ...link });
  }
  for (const group of groups) {
    if (group.audience) create('assetGroupSignal', { assetGroup: group.resourceName, audience: { audience: group.audience } });
    for (const theme of group.themes) create('assetGroupSignal', { assetGroup: group.resourceName, searchTheme: { text: theme } });
  }

  for (const [ids, name, field, property] of [
    [draft.targeting.locationIds, 'geoTargetConstants', 'location', 'geoTargetConstant'],
    [draft.targeting.languageIds, 'languageConstants', 'language', 'languageConstant'],
  ]) {
    for (const target of new Set(ids)) create('campaignCriterion', { campaign, [field]: { [property]: name + '/' + target } });
  }
  return operations;
}

async function createPerformanceMax(input, dependencies) {
  const draft = validatePerformanceMax(input);
  const ctx = await dependencies.context(input);
  const hasAudiences = draft.groups.some((group) => group.audience || group.segments.length);
  const [{ goals, actions, canSelectActions }, audienceData] = await Promise.all([
    conversionOptions(ctx, dependencies),
    hasAudiences ? audienceOptions(ctx, dependencies) : { options: [] },
  ]);
  const eligible = new Set(actions.filter(isPrimary).map((action) => action.goalKey));
  if (input.goalMode === 'ACCOUNT' && !goals.some((goal) => goal.biddable && eligible.has(goal.key))) {
    fail('Set up at least one enabled primary conversion action and biddable goal in Google Ads, or select eligible campaign goals.');
  }
  if (draft.goals.some((key) => !eligible.has(key) || !goals.some((goal) => goal.key === key))) {
    fail('One or more conversion goals are no longer eligible for the selected customer.');
  }
  if (input.goalMode === 'ACTIONS') {
    if (!canSelectActions) fail('Individual actions are available only when the selected customer owns its conversion tracking');
    const eligibleActions = new Set(actions.filter((action) => action.status === 'ENABLED').map((action) => action.id));
    const validResource = (action) => /^customers\/(\d{10})\/conversionActions\/\d+$/.exec(action)?.[1] === ctx.customerId;
    if (draft.conversionActions.some((action) => !eligibleActions.has(action) || !validResource(action))) {
      fail('One or more actions are no longer enabled for the selected customer');
    }
  }
  const audienceCatalog = new Map(audienceData.options.map((option) => [option.id, option]));
  for (const group of draft.groups) {
    if ((group.audience && audienceCatalog.get(group.audience)?.type !== 'audiences') ||
        group.segments.some((segment) => !['lists', 'custom'].includes(audienceCatalog.get(segment)?.type))) {
      fail('An audience selection is unavailable for the selected customer. Refresh the available audiences.');
    }
  }

  const operations = buildOperations(ctx, input, draft, audienceCatalog);
  if (operations.length > 10000) fail('This campaign exceeds the Google Ads limit on operations per request');
  const customGoal = input.goalMode === 'ACTIONS' ? await resolveCustomConversionGoal(ctx, dependencies, draft) : undefined;
  let result;
  try {
    result = await requestGoogleAdsApi({
      ...ctx, operation: 'performance_max_create', endpoint: '/customers/:customerId/googleAds:mutate',
      method: 'POST', operationKind: 'mutation', retryPolicy: 'never',
      timeoutMs: 60000, body: { mutateOperations: operations, partialFailure: false },
    });
  } catch (error) {
    if (['network_or_timeout', 'temporary_google_api_failure', 'unexpected_internal_error'].includes(error.category)) {
      error.creationUncertain = true;
      error.message = 'Google Ads did not return a confirmed result. Refresh the campaign list and check the campaign name before trying again.';
      throw error;
    }
    throw reportGoogleAdsError(error);
  }
  const responses = result.mutateOperationResponses || [];
  const groupResources = responses.flatMap((item) => item.assetGroupResult?.resourceName ? [item.assetGroupResult.resourceName] : []);
  const resourceName = responses.find((item) => item.campaignResult)?.campaignResult?.resourceName;
  const campaignId = resourceName?.match(/^customers\/(\d+)\/campaigns\/(\d+)$/);
  if (!campaignId || campaignId[1] !== ctx.customerId || result.partialFailureError || responses.length !== operations.length || groupResources.length !== draft.groups.length) {
    throw Object.assign(new Error('Google Ads returned an incomplete confirmation. Refresh the campaign list before trying again.'), { status: 502, creationUncertain: true });
  }
  if (input.goalMode !== 'ACCOUNT') {
    try {
      await configureCampaignGoals(ctx, dependencies, campaignId[2], draft.goals, customGoal, goals.map((goal) => goal.key));
    } catch (error) {
      error.message = `Google Ads created paused campaign ${campaignId[2]}, but its requested conversion goals could not be confirmed. Review the campaign before enabling it or attempting creation again.`;
      throw Object.assign(reportGoogleAdsError(error), { campaignId: campaignId[2], creationUncertain: true });
    }
  }
  let campaign;
  try {
    for (let attempt = 0; attempt < 3 && !campaign; attempt += 1) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, attempt * 350));
      const [row] = await dependencies.search(ctx, 'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.id = ' + campaignId[2]);
      campaign = row?.campaign;
    }
  } catch (error) {
    throw Object.assign(error, { message: 'Google Ads accepted campaign ' + campaignId[2] + ', but its status could not be retrieved. Refresh the list to verify it.', campaignId: campaignId[2], creationUncertain: true });
  }
  if (String(campaign?.id) !== campaignId[2] || campaign.advertising_channel_type !== 'PERFORMANCE_MAX' || campaign.status !== 'PAUSED') {
    throw Object.assign(new Error('Google Ads accepted campaign ' + campaignId[2] + ', but it could not be verified as a paused Performance Max campaign. Refresh the campaign list.'), { status: 502, campaignId: campaignId[2], creationUncertain: true });
  }
  return {
    success: true, created: true, campaignId: campaignId[2], resourceName, status: campaign.status,
    campaignType: campaign.advertising_channel_type,
    assetGroups: groupResources,
    message: 'Performance Max campaign confirmed by Google Ads',
  };
}

module.exports = { createPerformanceMax, performanceMaxOptions };
