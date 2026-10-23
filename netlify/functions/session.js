const {
  connectBlobs,
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
} = require("./_shared");

function clip(v, n) {
  return String(v || "").trim().slice(0, n);
}

// "Becky", "becky reel", "Becky  Reel" all count as the same person.
function firstName(n) {
  return String(n || "").trim().toLowerCase().split(/\s+/)[0] || "";
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

// GET  ?token=...              -> restore a conversation (same browser)
// POST {action:"start", ...}   -> resume an unfinished conversation for this
//                                 name + email, or start a new one
exports.handler = async (event) => {
  connectBlobs(event);
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
  if (body.action !== "start") return jsonResponse(400, { error: "Unknown action." });

  const email = clip(body.email, 200).toLowerCase();
  const name = clip(body.name, 120);
  if (!name) return jsonResponse(400, { error: "What should I call you?" });
  if (!EMAIL_RE.test(email)) return jsonResponse(400, { error: "That email doesn't look quite right. Mind checking it?" });

  const idx = emailIndexStore();
  const existingToken = await idx.get(emailKey(email));
  const existing = existingToken ? await loadSession(existingToken) : null;

  // Same name + email with an unfinished conversation: pick up where they left off.
  if (existing && !existing.complete) {
    if (firstName(existing.name) === firstName(name)) {
      return jsonResponse(200, { status: "resumed", session: publicView(existing) });
    }
    return jsonResponse(409, {
      error: "There's already a conversation going with this email under a different name. Use the same name you started with, or text Jessi at 630-965-6827 and she'll sort it out.",
    });
  }

  // No conversation yet, or the last one is finished (a repeat client's next
  // shoot): start a fresh one. The finished one stays in the archive.
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
  session.history.push({ role: "user", content: `Hi, I'm ${session.name}. I'm ready to talk about our shoot.` });
  session.history.push({ role: "assistant", content: `[PHASE:change]\n${openingMessage(session)}` });

  await saveSession(session);
  await idx.set(emailKey(email), session.token);

  return jsonResponse(200, { status: "started", session: publicView(session) });
};
