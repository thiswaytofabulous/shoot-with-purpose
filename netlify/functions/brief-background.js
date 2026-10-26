const Anthropic = require("@anthropic-ai/sdk");
const {
  connectBlobs,
  MODEL,
  BRIEF_SYSTEM_PROMPT,
  brandOf,
  transcriptText,
  loadSession,
  saveSession,
  emailShell,
  briefBodyHtml,
  transcriptBubblesHtml,
  escapeHtml,
  sendEmail,
  siteUrl,
} = require("./_shared");

// Background function (the -background suffix): Netlify answers 202 right
// away and lets this run for up to 15 minutes. Generates Jessi's strategy
// brief, saves it to the session, and emails it to her with the transcript.
// Any failure is saved as session.briefError so the admin archive can show it.
async function fail(session, msg, e) {
  console.error(msg, e || "");
  session.briefError = e && e.message ? `${msg}: ${e.message}` : msg;
  await saveSession(session);
}

exports.handler = async (event) => {
  connectBlobs(event);
  let token;
  try {
    ({ token } = JSON.parse(event.body || "{}"));
  } catch (e) {
    return;
  }
  const session = await loadSession(token);
  if (!session || !session.complete || session.briefSentAt) return;
  // Proof the job actually ran, for the admin status line.
  session.briefStartedAt = new Date().toISOString();
  delete session.briefError;
  await saveSession(session);
  try {
    await writeAndSend(session);
  } catch (e) {
    await fail(session, "The brief job crashed", e);
  }
};

async function writeAndSend(session) {
  const transcript = transcriptText(session);
  let brief = session.brief;
  if (!brief) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model: process.env.MODEL || MODEL,
        max_tokens: 1400,
        system: BRIEF_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Client: ${session.name}${session.business ? `, ${session.business}` : ""}\nBrand: ${brandOf(session.brand).name}\nShoot: ${session.shoot || "not specified"}\nReturning client: ${session.returning ? "yes" : "no"}\n\nPre-shoot conversation:\n\n${transcript}`,
        }],
      });
      brief = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      session.brief = brief;
      await saveSession(session);
    } catch (e) {
      await fail(session, "The AI brief didn't generate", e);
      brief = "(The AI brief didn't generate. The full conversation is below, and you can find it any time in the admin archive.)";
    }
  }

  const to = process.env.BRIEF_TO_EMAIL;
  const missing = ["BRIEF_TO_EMAIL", "RESEND_API_KEY"].filter((k) => !process.env[k]);
  if (missing.length) {
    await fail(session, `Email not sent: ${missing.join(" and ")} not set in Netlify. Brief saved here only`);
    return;
  }

  const b = brandOf(session.brand);
  const heading = `<p style="margin:0 0 4px;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${b.accent};">${escapeHtml(b.name)} · Pre-shoot brief</p>
    <p style="margin:0 0 24px;font-size:22px;font-weight:900;color:${b.navy};">${escapeHtml(session.name)}${session.business ? ` · ${escapeHtml(session.business)}` : ""}</p>`;
  const divider = `<div style="margin:28px 0;border-top:1px solid rgba(46,73,104,0.15);"></div>`;
  const convoHeading = `<p style="margin:0 0 16px;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${b.accent};">Full conversation</p>`;
  const archive = `<p style="margin:24px 0 0;font-size:12px;color:#5b6878;">Client email: ${escapeHtml(session.email)} · Archive: ${escapeHtml(siteUrl())}/admin.html</p>`;

  try {
    await sendEmail({
      brand: session.brand,
      to,
      replyTo: session.email,
      subject: `Pre-shoot brief: ${session.name}${session.business ? ` (${session.business})` : ""}`,
      html: emailShell(session.brand, heading + briefBodyHtml(session.brand, brief) + divider + convoHeading + transcriptBubblesHtml(session.brand, session) + archive, "New pre-shoot brief"),
      text: `${brief}\n\n---\n\nFULL CONVERSATION\n\n${transcript}\n\nClient email: ${session.email}`,
    });
    session.briefSentAt = new Date().toISOString();
    if (session.brief) delete session.briefError;
    await saveSession(session);
  } catch (e) {
    await fail(session, "The brief email didn't send", e);
  }
}
