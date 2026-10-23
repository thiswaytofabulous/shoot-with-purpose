const { connectBlobs, sessionsStore, displayMessages, jsonResponse } = require("./_shared");

// Feed for the TWTF Live Dashboard (submission-dashboard.netlify.app).
// Same contract as the Wizards and Brand Bestie: POST {action:"list", adminCode}
// -> {sessions:[...]}. Optional {brand:"hbm"|"twtf"} filters to one brand so the
// dashboard can show HBM and TWTF as separate rows like the other tools.
// The code is this site's ADMIN_TOKEN (or ADMIN_CODE if you'd rather set that).
exports.handler = async (event) => {
  connectBlobs(event);
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "POST only" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { error: "Bad JSON" });
  }

  if (body.action !== "list") return jsonResponse(400, { error: "Unknown action" });

  const expected = process.env.ADMIN_CODE || process.env.ADMIN_TOKEN;
  if (!expected || body.adminCode !== expected) return jsonResponse(401, { error: "Unauthorized" });

  const store = sessionsStore();
  const { blobs } = await store.list();
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));

  const sessions = all
    .filter(Boolean)
    .filter((s) => !body.brand || s.brand === body.brand)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map((s) => ({
      name: s.business ? `${s.name} · ${s.business}` : s.name,
      email: s.email,
      brand: s.brand,
      shoot: s.shoot || "",
      submitted: Boolean(s.complete),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      completedAt: s.completedAt || null,
      brief: s.brief || null,
      history: displayMessages(s).map((m) => ({ role: m.who === "client" ? "user" : "assistant", content: m.text })),
    }));

  return jsonResponse(200, { sessions });
};
