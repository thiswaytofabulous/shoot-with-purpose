const {
  brandOf,
  loadSession,
  saveSession,
  jsonResponse,
  emailShell,
  para,
  escapeHtml,
  sendEmail,
  buildConversationPdf,
} = require("./_shared");

// "Send me a PDF": emails the client a PDF of their own conversation. Only
// what they and Jessi said -- never the internal brief.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  if (!process.env.RESEND_API_KEY) return jsonResponse(500, { error: "Email isn't set up yet." });

  let token;
  try {
    ({ token } = JSON.parse(event.body || "{}"));
  } catch (e) {
    return jsonResponse(400, { error: "Malformed request." });
  }

  const session = await loadSession(token);
  if (!session) return jsonResponse(404, { error: "We couldn't find that conversation." });
  if ((session.copiesSent || 0) >= 5) return jsonResponse(429, { error: "I've already sent a few copies. Check your inbox (and spam folder)!" });

  try {
    const pdf = await buildConversationPdf(session);
    const b = brandOf(session.brand);
    const first = String(session.name || "").trim().split(/\s+/)[0] || "there";
    const safeName = String(session.business || session.name || "conversation").replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 60) || "conversation";

    const intro = session.brand === "twtf"
      ? `Hey ${escapeHtml(first)}! Here's your copy of our pre-shoot conversation, attached as a PDF. I'm going to sit with everything you shared and come back to you with a plan for the shoot.`
      : `Hi ${escapeHtml(first)}, here's your copy of our pre-shoot conversation, attached as a PDF. I'll review everything you shared and follow up with a plan for the shoot.`;
    const html = emailShell(
      session.brand,
      para(session.brand, intro) +
        para(session.brand, `Thought of something else? Just reply to this email or text me at 630-965-6827.`) +
        para(session.brand, `<strong style="color:${b.accent};">Jessi</strong>`),
      "Your pre-shoot conversation, as a PDF"
    );

    await sendEmail({
      brand: session.brand,
      to: session.email,
      replyTo: process.env.REPLY_TO_EMAIL || process.env.BRIEF_TO_EMAIL,
      subject: "Your pre-shoot conversation with Jessi (PDF)",
      html,
      text: `${intro.replace(/<[^>]+>/g, "")}\n\nThought of something else? Reply to this email or text me at 630-965-6827.\n\nJessi`,
      attachments: [{ filename: `Pre-Shoot Conversation - ${safeName}.pdf`, content: pdf.toString("base64") }],
    });

    session.copiesSent = (session.copiesSent || 0) + 1;
    await saveSession(session);
    return jsonResponse(200, { sent: true, email: session.email });
  } catch (e) {
    console.error("client copy failed", e);
    return jsonResponse(502, { error: "That didn't send. Try again in a moment?" });
  }
};
