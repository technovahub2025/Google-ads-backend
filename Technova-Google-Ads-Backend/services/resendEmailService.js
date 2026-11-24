const { Resend } = require("resend");

const sendClientGoogleAdsInvitation = async ({ to, clientName, invitationUrl }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    const error = new Error("RESEND_API_KEY and RESEND_FROM_EMAIL must be configured");
    error.code = "EMAIL_CONFIGURATION_MISSING";
    throw error;
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject: "Connect your Google Ads account",
    html: `<p>Hello ${escapeHtml(clientName)},</p><p>Please connect your Google Ads account to continue. You can approve or reject Google's permission request.</p><p><a href="${escapeHtml(invitationUrl)}" style="display:inline-block;padding:12px 18px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:6px">Connect Google Ads</a></p>`,
    text: `Hello ${clientName},\n\nPlease connect your Google Ads account to continue. You can approve or reject Google's permission request.\n\nConnect Google Ads: ${invitationUrl}`,
  });
  if (error) throw new Error(error.message || "Resend rejected the email");
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

module.exports = { sendClientGoogleAdsInvitation };
