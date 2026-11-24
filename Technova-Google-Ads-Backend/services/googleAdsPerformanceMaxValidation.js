
const { fail, text, micros, dates, id } = require('./googleAdsManagementFields');

const IMAGE_LIMIT = 5120 * 1024;
const UPLOAD_LIMIT = 24 * 1024 * 1024;
const assetLength = (value) => [...value.trim()].reduce((length, character) =>
  length + (/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\u3000\uFF01-\uFF60\uFFE0-\uFFE6]/u.test(character) ? 2 : 1), 0);
const FONTS = ['Open Sans', 'Roboto', 'Montserrat', 'Poppins', 'Lato', 'Oswald', 'Playfair Display', 'Roboto Slab'];
const TEXT_ASSETS = {
  headlines: ['HEADLINE', 3, 15, 30],
  longHeadlines: ['LONG_HEADLINE', 1, 5, 90],
  descriptions: ['DESCRIPTION', 2, 5, 90],
};
const IMAGE_ASSETS = {
  landscape: ['MARKETING_IMAGE', 1, 20, 600, 314, 1.91],
  square: ['SQUARE_MARKETING_IMAGE', 1, 20, 300, 300, 1],
  portrait: ['PORTRAIT_MARKETING_IMAGE', 0, 20, 480, 600, 0.8],
  logos: ['LOGO', 1, 5, 128, 128, 1],
  landscapeLogos: ['LANDSCAPE_LOGO', 0, 4, 512, 128, 4],
};

const list = (value, label, min, max) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(label + ' requires ' + min + ' to ' + max + ' entries');
  return value;
};

const unique = (values, label) => {
  if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) fail(label + ' must be unique');
  return values;
};

const stringList = (value, label, min, max, length) =>
  unique(list(value, label, min, max).map((entry) => text(entry, label, length)), label);

function imageDimensions(bytes) {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND') {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) && bytes.at(-1) === 0x3b) {
    return [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
  }
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return [];
  let offset = 2;
  while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[++offset];
    if (marker === 0xff) continue;
    offset += 1;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length || marker === 0xda) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    offset += length;
  }
  return [];
}

function validatePerformanceMax(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('A campaign request body is required');
  if (input.campaignType !== 'PERFORMANCE_MAX') fail('Only Performance Max campaign creation is supported');
  if (input.status && input.status !== 'PAUSED') fail('New campaigns must be PAUSED');
  const name = text(input.name, 'Campaign name');
  if (!['SALES', 'LEADS', 'OTHER'].includes(input.objective)) fail('Choose a campaign objective');
  if (!['CONTAINS_EU_POLITICAL_ADVERTISING', 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING'].includes(input.euPoliticalAdvertising)) fail('Choose the EU political advertising declaration');
  if (!['PRESENCE', 'PRESENCE_OR_INTEREST'].includes(input.locationMode)) fail('Choose a location targeting option');
  if (typeof input.urlExpansion !== 'boolean') fail('Choose whether to use final URL expansion');
  const targeting = {
    locationIds: list(input.locationIds, 'Locations', 0, 1000).map((value) => id(value, 'Location ID')),
    languageIds: list(input.languageIds, 'Languages', 0, 100).map((value) => id(value, 'Language ID')),
  };
  const schedule = dates(input);
  const bidding = {};
  if (input.biddingStrategy === 'MAXIMIZE_CONVERSIONS' && !input.targetRoas) {
    bidding.maximizeConversions = input.targetCpa ? { targetCpaMicros: micros(input.targetCpa) } : {};
  } else if (input.biddingStrategy === 'MAXIMIZE_CONVERSION_VALUE' && !input.targetCpa) {
    const roas = input.targetRoas;
    if (roas && (!/^\d+(?:\.\d+)?$/.test(String(roas)) || !Number.isFinite(Number(roas)) || Number(roas) <= 0)) fail('Enter a positive target ROAS percentage');
    bidding.maximizeConversionValue = roas ? { targetRoas: Number(roas) / 100 } : {};
  } else fail('Select a supported bidding strategy and matching target');
  const amountMicros = micros(input.budgetAmount);
  const goals = stringList(input.goals, 'Conversion goals', 0, 1000, 160);
  const conversionActions = stringList(input.conversionActions ?? [], 'Conversion actions', 0, 100, 150);
  if (!['ACCOUNT', 'CAMPAIGN', 'ACTIONS'].includes(input.goalMode) || ((input.goalMode === 'CAMPAIGN') !== Boolean(goals.length)) || ((input.goalMode === 'ACTIONS') !== Boolean(conversionActions.length))) {
    fail('Choose account defaults, campaign goals, or individual conversion actions');
  }

  let imageBytes = 0;
  const images = (field, value, label) => {
    const [fieldType, min, max, widthMin, heightMin, ratio] = IMAGE_ASSETS[field];
    const entries = list(value, label, min, max).map((image) => {
      if (typeof image !== 'string' || image.length > Math.ceil(IMAGE_LIMIT / 3) * 4 ||
          image.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) fail(label + ' must use a JPG, PNG or GIF up to 5 MB');
      const bytes = Buffer.from(image, 'base64');
      const [width, height] = imageDimensions(bytes);
      if (bytes.length > IMAGE_LIMIT || !width || width < widthMin || height < heightMin || Math.abs(width / height - ratio) > ratio * 0.01) {
        fail(label + ' must meet its required aspect ratio and minimum dimensions');
      }
      imageBytes += bytes.length;
      if (imageBytes > UPLOAD_LIMIT) fail('Images must total 24 MB or less per campaign');
      return image;
    });
    if (new Set(entries).size !== entries.length) fail(label + ' contains duplicate images');
    return entries.map((data) => ({ fieldType, content: { imageAsset: { data } } }));
  };

  const businessName = text(input.businessName, 'Business name', 25);
  if (assetLength(businessName) > 25) fail('Business name exceeds 25 characters');
  const brand = [
    { fieldType: 'BUSINESS_NAME', content: { textAsset: { text: businessName } } },
    ...images('logos', input.logos, 'Square logos'),
    ...images('landscapeLogos', input.landscapeLogos, 'Landscape logo'),
  ];
  if (brand.length > 6) fail('Add no more than five logos across square and landscape formats');
  const groups = list(input.groups, 'Asset groups', 1, 100).map((group, index) => {
    const label = 'Asset group ' + (index + 1);
    const groupName = text(group?.name, label + ' name');
    let url;
    try { url = new URL(group.finalUrl); } catch { fail(label + ' requires a valid final URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) fail(label + ' requires an HTTP(S) final URL without credentials (maximum 2048 characters)');
    const assets = [];
    for (const [field, [fieldType, min, max, length]] of Object.entries(TEXT_ASSETS)) {
      for (const value of stringList(group[field], label + ' ' + field, min, max, length)) {
        if (assetLength(value) > length) fail(label + ' ' + field + ' exceeds ' + length + ' characters');
        assets.push({ fieldType, content: { textAsset: { text: value } } });
      }
    }
    for (const field of ['landscape', 'square', 'portrait']) assets.push(...images(field, group[field], label + ' ' + field + ' images'));
    for (const video of stringList(group.videos, label + ' YouTube video IDs', 0, 15, 11)) {
      if (!/^[\w-]{11}$/.test(video)) fail(label + ' has an invalid YouTube video ID');
      assets.push({ fieldType: 'YOUTUBE_VIDEO', content: { youtubeVideoAsset: { youtubeVideoId: video } } });
    }
    const audience = group.audience ? text(group.audience, label + ' audience', 150) : '';
    const segments = stringList(group.segments, label + ' segments', 0, 50, 150);
    if (audience && segments.length) fail(label + ' must use either an existing audience or individual segments');
    return { name: groupName, finalUrl: url.href, assets, audience, segments, themes: stringList(group.themes, label + ' search themes', 0, 50, 80) };
  });
  unique(groups.map((group) => group.name), 'Asset group names');
  const finalUrlSuffix = input.finalUrlSuffix ? text(input.finalUrlSuffix, 'Final URL suffix', 2048) : '';
  if (finalUrlSuffix && !/^[^?&#\s=]+=[^&#\s]*(?:&[^?&#\s=]+=[^&#\s]*)*$/.test(finalUrlSuffix)) fail('Enter URL suffix parameters without a leading question mark');
  const { mainColor, accentColor, fontFamily } = input;
  const brandGuidelines = {};
  if (mainColor || accentColor) {
    if (![mainColor, accentColor].every((value) => /^#[0-9a-f]{6}$/i.test(value || ''))) fail('Enter both a main and an accent color in hexadecimal format');
    Object.assign(brandGuidelines, { mainColor, accentColor });
  }
  if (fontFamily) {
    if (!FONTS.includes(fontFamily)) fail('Choose a supported brand font');
    brandGuidelines.predefinedFontFamily = fontFamily;
  }
  return { name, amountMicros, bidding, schedule, targeting, goals, conversionActions, brand, groups, finalUrlSuffix, brandGuidelines };
}

module.exports = { validatePerformanceMax };
