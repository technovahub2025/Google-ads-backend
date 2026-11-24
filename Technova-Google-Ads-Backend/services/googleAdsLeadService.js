const db = require("../config/firebase");
const { getGoogleAdsConnection, getGoogleAdsClient } = require("../model/GoogleAdsConnection");

const LEADS = "google_ads_leads";
const MAPPINGS = "google_ads_lead_mappings";

const normalizeCustomerId = (value) => String(value || "").replace(/-/g, "");
const cleanString = (value) => value === undefined || value === null ? "" : String(value).trim();

const columnValues = (columns = []) => columns.reduce((result, column) => {
  const id = cleanString(column?.column_id || column?.column_name).toUpperCase();
  const value = cleanString(column?.string_value);
  if (id && value && !result[id]) result[id] = value;
  return result;
}, {});

const contactFromColumns = (values) => ({
  name: values.FULL_NAME || [values.FIRST_NAME, values.LAST_NAME].filter(Boolean).join(" "),
  email: values.EMAIL || values.WORK_EMAIL,
  phone: values.PHONE_NUMBER || values.WORK_PHONE,
});

const findMapping = async (googleKey, formId) => {
  if (!googleKey) return null;
  const snapshot = await db.collection(MAPPINGS).where("googleKey", "==", String(googleKey)).get();
  const matches = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((mapping) => !mapping.formId || String(mapping.formId) === String(formId || ""));
  return matches.length === 1 ? matches[0] : null;
};

const ingestGoogleLead = async (payload) => {
  const leadId = cleanString(payload?.lead_id);
  const googleKey = cleanString(payload?.google_key);
  const formId = cleanString(payload?.form_id);
  if (!leadId || !googleKey) throw Object.assign(new Error("lead_id and google_key are required"), { status: 400 });
  const mapping = await findMapping(googleKey, formId);
  if (!mapping) throw Object.assign(new Error("Google lead webhook is not mapped to a NEXION client"), { status: 403 });
  const values = columnValues(payload.user_column_data);
  const contact = contactFromColumns(values);
  const needsReview = !contact.name || (!contact.email && !contact.phone);
  const ref = db.collection(LEADS).doc(leadId);
  const record = {
    source: "Google Ads", provider: "google_ads", leadId, customerId: normalizeCustomerId(mapping.customerId),
    clientId: cleanString(mapping.clientId), companyId: cleanString(mapping.companyId), connectionId: cleanString(mapping.connectionId),
    formId, campaignId: cleanString(payload.campaign_id), adGroupId: cleanString(payload.adgroup_id), creativeId: cleanString(payload.creative_id),
    assetGroupId: cleanString(payload.asset_group_id), leadStage: cleanString(payload.lead_stage), leadSource: cleanString(payload.lead_source || "LEAD_FORM"),
    gclId: cleanString(payload.gcl_id), isTest: payload.is_test === true, submittedAt: payload.lead_submit_time ? new Date(payload.lead_submit_time) : new Date(),
    contact, formResponses: values, status: needsReview ? "review" : "new", needsReview, whatsappConsent: false,
    updatedAt: new Date(), receivedAt: new Date(),
  };
  const result = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return { duplicate: true, lead: { leadId, ...existing.data() } };
    tx.create(ref, record);
    return { duplicate: false, lead: { leadId, ...record } };
  });
  return result;
};

const listGoogleLeads = async ({ customerId, page = 1, pageSize = 25, search, status, campaignId, startDate, endDate }) => {
  const normalizedCustomerId = normalizeCustomerId(customerId);
  if (!/^\d{10}$/.test(normalizedCustomerId)) throw Object.assign(new Error("A valid Google Ads customer ID is required"), { status: 400 });
  const snapshot = await db.collection(LEADS).where("customerId", "==", normalizedCustomerId).get();
  let rows = snapshot.docs.map((doc) => ({ leadId: doc.id, ...doc.data() }));
  const query = cleanString(search).toLowerCase();
  rows = rows.filter((lead) => (!status || lead.status === status) && (!campaignId || String(lead.campaignId) === String(campaignId)) &&
    (!query || [lead.leadId, lead.contact?.name, lead.contact?.email, lead.contact?.phone, lead.campaignId].some((value) => String(value || "").toLowerCase().includes(query))) &&
    (!startDate || new Date(lead.submittedAt?.toDate?.() || lead.submittedAt) >= new Date(`${startDate}T00:00:00Z`)) &&
    (!endDate || new Date(lead.submittedAt?.toDate?.() || lead.submittedAt) <= new Date(`${endDate}T23:59:59.999Z`)));
  rows.sort((a, b) => new Date(b.submittedAt?.toDate?.() || b.submittedAt) - new Date(a.submittedAt?.toDate?.() || a.submittedAt));
  const total = rows.length; const safePageSize = Math.min(Math.max(Number(pageSize) || 25, 1), 100); const safePage = Math.max(Number(page) || 1, 1);
  const pageRows = rows.slice((safePage - 1) * safePageSize, safePage * safePageSize);
  return { leads: pageRows, pagination: { page: safePage, pageSize: safePageSize, total, pages: Math.ceil(total / safePageSize) }, stats: {
    total, new: rows.filter((lead) => lead.status === "new").length, contacted: rows.filter((lead) => lead.status === "contacted").length, converted: rows.filter((lead) => lead.status === "converted").length,
  } };
};

const updateGoogleLead = async (leadId, customerId, changes) => {
  const ref = db.collection(LEADS).doc(String(leadId));
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || normalizeCustomerId(snapshot.data().customerId) !== normalizeCustomerId(customerId)) return null;
    const allowed = {}; if (["new", "review", "contacted", "converted", "lost"].includes(changes.status)) allowed.status = changes.status;
    if (typeof changes.assigneeId === "string") allowed.assigneeId = changes.assigneeId.trim() || null;
    if (!Object.keys(allowed).length) throw Object.assign(new Error("No supported lead changes supplied"), { status: 400 });
    allowed.updatedAt = new Date(); tx.update(ref, allowed); return { leadId: ref.id, ...snapshot.data(), ...allowed };
  });
};

const saveLeadMapping = async (mapping) => {
  const customerId = normalizeCustomerId(mapping.customerId);
  if (!/^\d{10}$/.test(customerId) || !mapping.googleKey || !mapping.clientId || !mapping.companyId || !mapping.connectionId) {
    throw Object.assign(new Error("customerId, googleKey, clientId, companyId and connectionId are required"), { status: 400 });
  }
  const connection = await getGoogleAdsConnection(mapping.connectionId);
  if (!connection?.connected) throw Object.assign(new Error("Google Ads connection not found or disconnected"), { status: 404 });
  const clientEntry = await getGoogleAdsClient(mapping.clientId);
  if (!clientEntry || String(clientEntry.client.companyId || "") !== String(mapping.companyId)) throw Object.assign(new Error("Google Ads client does not belong to the supplied company"), { status: 403 });
  const knownAccounts = [connection.googleAccount, ...(connection.googleAdsAccounts || [])].filter(Boolean).map((account) => normalizeCustomerId(account.id || account.customerId));
  if (connection.customerId && normalizeCustomerId(connection.customerId) !== customerId && !knownAccounts.includes(customerId)) throw Object.assign(new Error("Customer account is not authorized by this Google Ads connection"), { status: 403 });
  const ref = db.collection(MAPPINGS).doc();
  const data = { customerId, googleKey: String(mapping.googleKey).trim(), ...(mapping.formId ? { formId: String(mapping.formId) } : {}), clientId: String(mapping.clientId), companyId: String(mapping.companyId), connectionId: String(mapping.connectionId), createdAt: new Date(), updatedAt: new Date() };
  await ref.create(data); return { mappingId: ref.id, ...data };
};

module.exports = { ingestGoogleLead, listGoogleLeads, updateGoogleLead, saveLeadMapping };
