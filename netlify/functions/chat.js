const Anthropic = require("@anthropic-ai/sdk");
const {
  MODEL,
  MAX_MESSAGES,
  MAX_USER_CHARS,
  systemPrompt,
  parseTags,
  loadSession,
  saveSession,
  siteUrl,
  jsonResponse,
} = require("./_shared");

const ALLOWED_IMAGE = /^image\/(png|jpeg|gif|webp)$/;

// Only accept the attachment shapes the page builds, so nobody can smuggle
// arbitrary content blocks into the API call.
function cleanAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 3).map((a) => {
    if (!a || typeof a !== "object") return null;
    if (a.type === "text" && typeof a.text === "string") return { type: "text", text: a.text.slice(0, 50000) };
    if (a.type === "image" && a.source && a.source.type === "base64" && ALLOWED_IMAGE.test(a.source.media_type) && typeof a.source.data === "string") {
      return { type: "image", source: { type: "base64", media_type: a.source.media_type, data: a.source.data } };
    }
    if (a.type === "document" && a.source && a.source.type === "base64" && a.source.media_type === "application/pdf" && typeof a.source.data === "string") {
      return { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.source.data } };
    }
    return null;
  }).filter(Boolean);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  if (!process.env.ANTHROPIC_API_KEY) return jsonResponse(500, { error: "Server is not configured (missing ANTHROPIC_API_KEY)." });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { error: "Malformed request." });
  }

  const session = await loadSession(body.token);
  if (!session) return jsonResponse(404, { error: "We couldn't find that conversation." });
  if (session.complete) return jsonResponse(409, { error: "This conversation is already wrapped up." });
  if (session.history.length >= MAX_MESSAGES) return jsonResponse(429, { error: "We've covered a lot! Let's wrap up here." });

  const text = String(body.text || "").slice(0, MAX_USER_CHARS).trim();
  const attachments = cleanAttachments(body.attachments);
  const names = (Array.isArray(body.attachmentNames) ? body.attachmentNames : []).slice(0, 3).map((n) => String(n).slice(0, 120));
  if (!text && !attachments.length) return jsonResponse(400, { error: "Nothing to send." });

  const userTurn = attachments.length
    ? { role: "user", content: [...(text ? [{ type: "text", text }] : []), ...attachments] }
    : { role: "user", content: text };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let raw;
  try {
    const response = await client.messages.create({
      model: process.env.MODEL || MODEL,
      max_tokens: 900,
      system: systemPrompt(session),
      messages: [...session.history, userTurn],
    });
    raw = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  } catch (e) {
    console.error("chat error:", e);
    return jsonResponse(502, { error: "I hit a snag on my end. Give that another send in a moment?" });
  }

  // Store files as short placeholders so later turns stay small; Jessi has
  // already reacted to them by now.
  const placeholder = names.map((n) => `[Attached file: ${n}]`).join("\n");
  session.history.push({ role: "user", content: [text, placeholder].filter(Boolean).join("\n") || "[Attachment]" });
  session.history.push({ role: "assistant", content: raw });

  const parsed = parseTags(raw);
  if (parsed.phase) session.phase = parsed.phase;
  if (parsed.complete) {
    session.complete = true;
    session.phase = "wrap";
    session.completedAt = new Date().toISOString();
  }
  await saveSession(session);

  if (parsed.complete) {
    // Kick off the brief for Jessi. Background functions answer 202 at once
    // and keep running, so this doesn't slow the client down.
    try {
      await fetch(`${siteUrl()}/.netlify/functions/brief-background`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: session.token }),
      });
    } catch (e) {
      console.error("brief trigger failed", e);
    }
  }

  return jsonResponse(200, { text: parsed.text, phase: session.phase, complete: Boolean(parsed.complete) });
};
