const { connectBlobs, sessionsStore, loadSession, saveSession, displayMessages, brandOf, siteUrl, jsonResponse } = require("./_shared");

// Token-gated archive of every conversation (in progress and complete).
// Set ADMIN_TOKEN to a long random string in Netlify env vars.
function isAuthorized(event) {
  const token = event.queryStringParameters && event.queryStringParameters.token;
  return Boolean(process.env.ADMIN_TOKEN) && token === process.env.ADMIN_TOKEN;
}

exports.handler = async (event) => {
  connectBlobs(event);
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  if (!process.env.ADMIN_TOKEN) return jsonResponse(500, { error: "Admin access isn't configured yet (set ADMIN_TOKEN)." });
  if (!isAuthorized(event)) return jsonResponse(401, { error: "Unauthorized" });

  // POST ?id=... -> (re)generate and email the brief for a finished conversation.
  if (event.httpMethod === "POST") {
    const s = await loadSession(event.queryStringParameters && event.queryStringParameters.id);
    if (!s) return jsonResponse(404, { error: "Not found" });
    if (!s.complete) return jsonResponse(409, { error: "This conversation isn't finished yet." });
    const missing = ["ANTHROPIC_API_KEY", "BRIEF_TO_EMAIL", "RESEND_API_KEY"].filter((k) => !process.env[k]);
    if (missing.length) return jsonResponse(500, { error: `Can't send: ${missing.join(", ")} not set in Netlify (Site configuration → Environment variables). Add it, redeploy, and try again.` });
    delete s.briefSentAt;
    delete s.briefError;
    delete s.briefStartedAt;
    s.briefRequestedAt = new Date().toISOString();
    await saveSession(s);
    const res = await fetch(`${siteUrl()}/.netlify/functions/brief-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: s.token }),
    });
    if (!res.ok) return jsonResponse(502, { error: `The brief job wouldn't start (Netlify answered ${res.status}).` });
    return jsonResponse(202, { status: "sending" });
  }

  const store = sessionsStore();
  const id = event.queryStringParameters && event.queryStringParameters.id;

  if (id) {
    const s = await store.get(id, { type: "json" });
    if (!s) return jsonResponse(404, { error: "Not found" });
    return jsonResponse(200, {
      id: s.token,
      name: s.name,
      business: s.business,
      email: s.email,
      brand: brandOf(s.brand).name,
      shoot: s.shoot,
      phase: s.phase,
      complete: Boolean(s.complete),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      completedAt: s.completedAt,
      brief: s.brief || null,
      briefSentAt: s.briefSentAt || null,
      briefError: s.briefError || null,
      briefRequestedAt: s.briefRequestedAt || null,
      briefStartedAt: s.briefStartedAt || null,
      messages: displayMessages(s),
    });
  }

  const { blobs } = await store.list();
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  const intakes = all
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map((s) => ({
      id: s.token,
      name: s.name,
      business: s.business,
      email: s.email,
      brand: s.brand,
      phase: s.phase,
      complete: Boolean(s.complete),
      updatedAt: s.updatedAt,
      turns: Math.max(0, Math.floor((s.history.length - 1) / 2)),
    }));
  return jsonResponse(200, { intakes });
};
