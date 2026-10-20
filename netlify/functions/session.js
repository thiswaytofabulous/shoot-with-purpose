const {
  EMAIL_RE,
  brandOf,
  openingMessage,
  displayMessages,
  emailIndexStore,
  emailKey,
  newToken,
  loadSession,
  saveSession,
  jsonResponse,
  sendResumeEmail,
} = require("./_shared");

function clip(v, n) {
  return String(v || "").trim().slice(0, n);
}

function publicView(s) {
  return {
    token: s.token,
    name: s.name,
    business: s.business,
    email: s.email,
    brand: s.brand,
    shoot: s.shoot,
    phase: s.phase,
    complete: Boolean(s.complete),
    messages: displayMessages(s),
  };
}

// GET  ?token=...                 -> restore a conversation
// POST {action:"start", ...}      -> start (or route to resume if this email has one in progress)
// POST {action:"resend", email}   -> email the resume link again
exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    const token = event.queryStringParameters && event.queryStringParameters.token;
    const s = await loadSession(token);
    if (!s) return jsonResponse(404, { error: "We couldn't find that conversation." });
    return jsonResponse(200, publicView(s));
  }

  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { error: "Malformed request." });
  }

  const email = clip(body.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return jsonResponse(400, { error: "That email doesn't look quite right. Mind checking it?" });

  const idx = emailIndexStore();
  const existingToken = await idx.get(emailKey(email));
  const existing = existingToken ? await loadSession(existingToken) : null;

  if (body.action === "resend") {
    if (existing && !existing.complete) {
      try { await sendResumeEmail(existing, { returning: true }); } catch (e) { console.error("resend failed", e); }
    }
    // Same answer either way, so this can't be used to probe who has a conversation.
    return jsonResponse(200, { status: "resume_sent" });
  }

  if (body.action !== "start") return jsonResponse(400, { error: "Unknown action." });

  // An unfinished conversation already exists for this email: don't open it
  // on an unverified device -- send the private link to their inbox instead.
  if (existing && !existing.complete) {
    try { await sendResumeEmail(existing, { returning: true }); } catch (e) { console.error("resume email failed", e); }
    return jsonResponse(200, { status: "resume_sent" });
  }

  const name = clip(body.name, 120);
  if (!name) return jsonResponse(400, { error: "What should I call you?" });

  const brand = brandOf(body.brand).key;
  const session = {
    token: newToken(),
    email,
    name,
    business: clip(body.business, 160),
    brand,
    shoot: clip(body.shoot, 160),
    phase: "change",
    complete: false,
    createdAt: new Date().toISOString(),
    history: [],
  };
  session.history.push({
    role: "user",
    content: `Hi, I'm ${session.name}${session.business ? ` from ${session.business}` : ""}. I'm ready to talk about our shoot.`,
  });
  session.history.push({ role: "assistant", content: `[PHASE:change]\n${openingMessage(session)}` });

  await saveSession(session);
  await idx.set(emailKey(email), session.token);

  let linkSent = false;
  try {
    await sendResumeEmail(session);
    linkSent = true;
  } catch (e) {
    console.error("welcome link email failed", e);
  }

  return jsonResponse(200, { status: "started", linkSent, session: publicView(session) });
};
