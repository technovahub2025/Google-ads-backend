const express = require("express");
const { ingestGoogleLead, listGoogleLeads, updateGoogleLead, saveLeadMapping } = require("../services/googleAdsLeadService");
const router = express.Router();

router.get("/leads", async (req, res) => {
  try { return res.json({ success: true, ...(await listGoogleLeads({ customerId: req.query.customerId, ...req.query })) }); }
  catch (error) { return res.status(error.status || 500).json({ success: false, message: error.message }); }
});
router.patch("/leads/:leadId", async (req, res) => {
  try { const lead = await updateGoogleLead(req.params.leadId, req.query.customerId, req.body || {}); if (!lead) return res.status(404).json({ success: false, message: "Google Ads lead not found" }); return res.json({ success: true, lead }); }
  catch (error) { return res.status(error.status || 500).json({ success: false, message: error.message }); }
});
router.post("/lead-mappings", async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ success: false, message: "Super Admin permission required" });
  try { return res.status(201).json({ success: true, mapping: await saveLeadMapping(req.body || {}) }); }
  catch (error) { return res.status(error.status || 500).json({ success: false, message: error.message }); }
});

module.exports = router;
