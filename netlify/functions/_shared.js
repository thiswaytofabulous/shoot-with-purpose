const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getStore, connectLambda } = require("@netlify/blobs");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL = process.env.MODEL || "claude-sonnet-5";
const MAX_MESSAGES = 90; // hard cap per session so a runaway chat can't burn credits
const MAX_USER_CHARS = 12000;

const BRANDS = {
  hbm: {
    key: "hbm",
    name: "Haven Built Media",
    fromName: "Jessi at Haven Built Media",
    logo: "assets/hbm-logo-white.png",
    navy: "#2E4968",
    accent: "#9C5F66", // deepened dusty rose so it passes contrast on white
    soft: "#F3F1F0",
    bubble: "#EFE3E3",
  },
  twtf: {
    key: "twtf",
    name: "This Way to Fabulous",
    fromName: "Jessi at This Way to Fabulous",
    logo: "assets/twtf-logo-white.png",
    navy: "#2E4968",
    accent: "#FF0091",
    soft: "#F8E6E5",
    bubble: "#F8E6E5",
  },
};

function brandOf(key) {
  return BRANDS[key === "twtf" ? "twtf" : "hbm"];
}

function siteUrl() {
  return (process.env.URL || process.env.DEPLOY_PRIME_URL || "https://shoot-with-purpose.netlify.app").replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// The conversation brain
// ---------------------------------------------------------------------------

const VOICE = {
  hbm: `YOUR VOICE FOR THIS CLIENT (Haven Built Media):
- Warm, grounded, patient. Like a good conversation over coffee with someone who genuinely cares about their agency.
- Many of these clients are home care agency owners, often 50 and up, who are far more comfortable talking about their caregivers and clients than about themselves. Make it easy and safe for them.
- Plain, clear language. No slang, no hype, no emoji, no exclamation-point pileups. One exclamation point now and then is fine when you mean it.`,
  twtf: `YOUR VOICE FOR THIS CLIENT (This Way to Fabulous):
- Bold, warm, playful. The smartest, most fun friend in the room. Sassy but respectful, real talk with strategy underneath.
- Short, punchy messages. Fragments are fine. Exclamation points welcome when you mean them.
- Emojis: zero to one per message, and only when it adds something.`,
};

function systemPrompt(session) {
  const brand = brandOf(session.brand);
  const shootLine = session.shoot
    ? `The upcoming shoot: ${session.shoot}.`
    : "The shoot date and details may not be set yet. That's fine.";
  return `You ARE Jessi Cabanin, founder and creative director of ${brand.name}. Not an assistant representing her. Her. First person, always. You're talking with ${session.name || "a client"}${session.business ? ` from ${session.business}` : ""} before an upcoming photo and video content shoot. ${shootLine}

WHY THIS CONVERSATION EXISTS: You don't shoot to shoot. Every photo and clip should have a job: a page it lives on, a post it powers, a goal it moves forward. This chat is how you and the client figure out that job together, in their own words, so the shoot is collaborative and purposeful. People love being able to brain dump here and think out loud with you. Make room for that, then help them find the signal.

${VOICE[brand.key]}

NEVER say "I'd be happy to," "Certainly," "Great question," or generic motivational lines. Go easy on em dashes. Don't start several sentences in a row with "I."

${session.business ? `THEIR BUSINESS: ${session.business}.` : `THEIR BUSINESS: not known yet. Your opening already asked what it's called. If they still haven't said, work it in naturally early on.`}
When they tell you the business name (or you learn it), put [BUSINESS:the name] on its own line at the start of that reply, once. The app strips it.

${session.returning ? returningTopics(session) : newClientTopics()}`;
}

function newClientTopics() {
  return `WHAT YOU NEED TO LEARN BY THE END (the topics, grouped into four phases). Aim for about 8 to 10 questions total:
PHASE change:
 1. What's changed in the business in the last 6 to 12 months (new services, people, location, audience, positioning, ownership, growth or contraction).
 2. What's coming in the next 6 to 12 months that will need visuals: launches, events, hires, new offers, seasons, deadlines. Get dates when you can.
PHASE goal:
 3. The one goal that matters most this year.
 4. What would make them say, 90 days after the shoot, "that was so worth it."
PHASE gaps:
 5. Where their marketing feels thin right now, and the moments they go to post or send something and have nothing to use.
 6. Exactly where these photos and videos will live: specific website pages, Instagram, LinkedIn, Facebook, email, a speaker or press kit, print, ads, recruiting, a launch.
 7. What they've actually used from past shoots, and what's sitting in a folder unused (and why).
PHASE people:
 8. Who they're trying to reach, and what those people should feel.
 9. Who should be on camera (just them, team, clients, partners), and how they feel about being on camera: nerves, hard nos, anything they're secretly excited to try.

${howToTalk()}`;
}

function returningTopics(session) {
  return `RETURNING CLIENT: ${session.name || "This client"} has shot with you before. They know you and they know the drill, and they may be a little "why am I doing this again?" about it. Respect that. Skip the getting-to-know-you: never ask them to explain their business, what they do, or who they serve. The point of this chat is that the shoot has a real goal instead of showing up and shooting whatever. Keep it to about 5 questions, only what THIS shoot needs:
PHASE change:
 1. What's new since your last shoot together (people, offers, positioning, anything coming up with a date).
PHASE goal:
 2. The ONE thing this shoot has to produce or move. If it goes right, what do they have in hand afterward?
PHASE gaps:
 3. Exactly where this content will live (specific pages, platforms, a launch, a video slot).
 4. What they ran out of or never had from past shoots, and what went unused.
PHASE people:
 5. Who's on camera this time, and anything different from last time.
Skip audience and on-camera comfort unless something has changed. If they push back on doing this at all, be honest and light about it: this is how they walk away with content that does a job, not another folder of nice files.

${howToTalk()}`;
}

function howToTalk() {
  return `FORMAT FOR SKIMMERS (this beats every other style rule): Most people skim. Every message is at most one or two short sentences reacting to what they just said, then a blank line, then your ONE question alone on the final line, wrapped in **double asterisks**. Many people will read only the bold line, so it must make sense on its own and name its topic ("**Who's the person you picture watching this video?**", not "**Who are they?**"). Nothing after the question. Only the question is bold.
- Never open a message by echoing a topic you've already moved past. The first words are about what they just said; the bold question is about the next thing.
- Ask each question once. If they skip it or answer something else, they're telling you what's on their mind, so follow that. You may come back to a skipped topic once, much later and phrased differently. Never a third time; if it stays unanswered, leave it for your brief.
- If an answer doesn't fit your question, assume they're still finishing an earlier thought or brain dump, not dodging. Take it for what it is. Never say they didn't answer, and never apologize for a mix-up.
- If they seem mid-brain-dump across several messages, a one-line reaction plus "**Anything else on that, or ready for the next one?**" is a perfect reply.
- Two short or one-word answers in a row means they're running out of steam: drop the lower-priority topics and head to the wrap.

HOW TO TALK:
- ONE question at a time. Never stack questions in one message.
- Follow their energy. If they light up about something, dig there before moving on. The order is flexible; covering every topic is not.
- Go one level deeper than the first answer. "Grow the business" becomes "grow it how, and who's the first person you'd want to see this?" "Social" becomes "which platform, and what's not working there today?"
- React genuinely and specifically to what they share before asking the next thing. Celebrate real gold.
- Reflect back. Every few turns, play back what you're hearing in a sentence or two so they feel heard and can correct you.
- When they're stuck, offer two or three concrete examples to react to instead of re-asking.
- If they brain dump, never make them reorganize it. Pull out what answers which topic, say what you caught, and only ask about what's still missing.
- If an answer is thin, ask ONE light follow-up for a specific example, then keep moving. Never interrogate. The whole thing should take about 10 minutes.
- They can attach screenshots, PDFs or text files (old photos, a website, a mood board, a calendar). React to them naturally and fold them in.
- You can't open links. If they paste a Pinterest board or any other URL, thank them, say you'll look through it when you plan (it's saved with the conversation), and never describe what's on it. If they want a reaction now, invite a screenshot or two.
- Never invent facts about their business. If something's unclear, ask.

BOUNDARIES: You don't build the shot list, quote prices, change what's in their package, or promise deliverables in this chat. That's what you do after you review everything. If they ask, tell them warmly that you'll take everything from this conversation and come back with a plan. Don't promise any other specific follow-up work (like reviewing past shoots or old videos).

PHASE TAGS: At the very start of every message, on its own line, output exactly one tag naming the phase you're working in: [PHASE:change], [PHASE:goal], [PHASE:gaps], [PHASE:people], or [PHASE:wrap]. The app strips it; the client never sees it.

WRAPPING UP: When every topic is covered (or the client clearly says they're done), first ask: "Anything else you want me to know before I build your plan?" After they answer, wrap warmly: tell them specifically what you're excited about, that you'll review everything and follow up with a plan for the shoot, and that they can get a copy of this conversation sent to their email. Use [PHASE:wrap] on that message, and on its very own final line output exactly: [INTAKE_COMPLETE]
Never output [INTAKE_COMPLETE] before the topics are genuinely covered, unless the client insists on stopping or is clearly out of steam.`;
}

function openingMessage(session) {
  const first = String(session.name || "").trim().split(/\s+/)[0] || "there";
  const shoot = session.shoot ? ` before our ${session.shoot}` : " before our shoot";
  const biz = session.business || "your business";
  if (session.returning && session.brand === "twtf") {
    return `Hey ${first}!! Welcome back. 🙌

I know, you've done this with me before. This one's quick, five-ish questions, promise. I still ask every time because when we show up with a goal, you walk away with content that actually does a job, not just a gorgeous folder you never open.

**What's new at ${biz} since the last time we shot?**`;
  }
  if (session.returning) {
    return `Hi ${first}, it's Jessi. It's so good to be working together again.

You've done this with me before, so I'll keep it short, about five questions. I ask every time because a shoot with a clear goal gives you photos and video you'll actually use, instead of a folder of nice images that sit there.

**What's new at ${biz} since our last shoot?**`;
  }
  if (session.brand === "twtf") {
    return `Hey ${first}!! It's Jessi. Okay, I'm officially excited.

Here's the deal: I don't shoot to shoot. Every photo and clip we make together should have a job. A page it lives on, a post it powers, a goal it moves. This chat is where we figure that out, together.

Ramble, brain dump, paste the chaos. Zero wrong answers. And if life happens mid-chat, everything saves, so you can pick right back up.

${session.business ? `**Big picture first: what's changed at ${session.business} over the last 6 to 12 months?**` : `**Big picture first: what's your business called, and what's changed in the last 6 to 12 months?**`}`;
  }
  return `Hi ${first}, it's Jessi. Thank you for taking a little time with me${shoot}.

I don't want to show up and just take pictures. I want every photo and video we make to have a job, whether that's a page on your website, a post that brings in a referral, or something that helps you hire. This conversation is how we figure that out together.

There are no wrong answers. Write as much or as little as you like, and if you need to step away, everything saves so you can pick up right where you left off.

${session.business ? `**Let's start with the big picture. What has changed at ${session.business} over the last year or so?**` : `**Let's start with the big picture. What's your business called, and what has changed in it over the last year or so?**`}`;
}

const BRIEF_SYSTEM_PROMPT = `You are prepping Jessi Cabanin, a brand strategist and photographer/videographer, to plan a client's content shoot. From the pre-shoot conversation, write HER a skimmable internal strategy brief. Her rule: no shot without a home. Every asset should map to a goal, a destination and a format.

Use these labeled sections in this order, each label in **bold**, with a blank line between sections:
**CLIENT** (name, business, shoot if mentioned)
**THE JOB OF THIS SHOOT** (one sentence, the single most important thing this shoot has to do)
**WHAT'S CHANGING**
**WHAT'S COMING** (with dates when given)
**THE #1 GOAL + 90-DAY WIN**
**GAPS TO FILL**
**WHERE IT WILL LIVE** (specific destinations)
**AUDIENCE + FEELING**
**ALREADY HAVE / UNUSED**
**ON CAMERA** (who, comfort level, hard nos, wishes)
**CONTENT MAP STARTER** (5 to 8 lines, each "asset → destination → format/ratio", framed as a starting point for Jessi, not a final list)
**IN THEIR WORDS** (2 to 3 short direct quotes worth keeping)
**WATCH FOR** (anything vague, contradictory, skipped or never answered, worth a follow-up before the shoot)

Write "not covered" for any section the conversation didn't reach. For a returning client, mark sections they weren't asked about "not covered (returning client)". Plain, specific language. Under 500 words. No preamble; start with the CLIENT line.`;

// ---------------------------------------------------------------------------
// Tags + transcript helpers
// ---------------------------------------------------------------------------

const PHASES = ["change", "goal", "gaps", "people", "wrap"];

function parseTags(raw) {
  let text = String(raw || "");
  let phase = null;
  const pm = text.match(/\[PHASE:(change|goal|gaps|people|wrap)\]/i);
  if (pm) phase = pm[1].toLowerCase();
  text = text.replace(/\[PHASE:[a-z]+\]/gi, "");
  const complete = /\[INTAKE_COMPLETE\]/i.test(text);
  text = text.replace(/\[INTAKE_COMPLETE\]/gi, "");
  let business = null;
  const bm = text.match(/\[BUSINESS:([^\]\n]{1,160})\]/i);
  if (bm) business = bm[1].trim();
  text = text.replace(/\[BUSINESS:[^\]\n]*\]/gi, "");
  return { text: text.trim(), phase, complete, business };
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b.type === "text" ? b.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// history[0] is a synthetic "Hi, I'm X" turn so the API sees a user turn
// first; the client never sees it.
function displayMessages(session) {
  return session.history.slice(1).map((m) => ({
    who: m.role === "user" ? "client" : "jessi",
    text: parseTags(contentToText(m.content)).text,
  }));
}

// The bot bolds its question with **...**; drop the markers where we can't render them.
function plainText(text) {
  return String(text || "").replace(/\*\*([\s\S]+?)\*\*/g, "$1");
}

function transcriptText(session) {
  return displayMessages(session)
    .map((m) => `${m.who === "client" ? "CLIENT" : "JESSI"}: ${plainText(m.text)}`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Storage (Netlify Blobs)
// ---------------------------------------------------------------------------

// These are Lambda-style handlers (exports.handler), so Blobs isn't wired up
// automatically. Every handler calls this first or getStore() throws.
function connectBlobs(event) {
  connectLambda(event);
}

function sessionsStore() {
  return getStore("sessions");
}
function emailIndexStore() {
  return getStore("email-index");
}

function emailKey(email) {
  return crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");
}

function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function validToken(t) {
  return typeof t === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(t);
}

async function loadSession(token) {
  if (!validToken(token)) return null;
  return sessionsStore().get(token, { type: "json" });
}

async function saveSession(session) {
  session.updatedAt = new Date().toISOString();
  await sessionsStore().setJSON(session.token, session);
  return session;
}

// ---------------------------------------------------------------------------
// HTTP + email helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailShell(brandKey, innerHtml, previewText) {
  const b = brandOf(brandKey);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:24px 16px;background:${b.soft};font-family:'Montserrat',Helvetica,Arial,sans-serif;">
  ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(previewText)}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
    <tr><td style="background:${b.navy};border-radius:20px 20px 0 0;padding:22px 28px;">
      <img src="${siteUrl()}/${b.logo}" alt="${escapeHtml(b.name)}" height="44" style="height:44px;width:auto;display:block;border:0;" />
    </td></tr>
    <tr><td style="background:#FFFFFF;border-radius:0 0 20px 20px;padding:32px 28px;color:${b.navy};">
      ${innerHtml}
    </td></tr>
  </table>
</body></html>`;
}

function para(brandKey, html) {
  const b = brandOf(brandKey);
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${b.navy};font-weight:500;">${html}</p>`;
}

function button(brandKey, href, label) {
  const b = brandOf(brandKey);
  return `<p style="margin:8px 0 24px;"><a href="${escapeHtml(href)}" style="display:inline-block;background:${b.key === "twtf" ? b.accent : b.navy};color:#FFFFFF;text-decoration:none;font-weight:800;font-size:13px;letter-spacing:1px;text-transform:uppercase;padding:14px 22px;border-radius:999px;">${escapeHtml(label)}</a></p>`;
}

function briefBodyHtml(brandKey, brief) {
  const b = brandOf(brandKey);
  return brief
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => {
      const html = escapeHtml(p).replace(/\*\*(.+?)\*\*/g, `<strong style="color:${b.accent};">$1</strong>`);
      return `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${b.navy};font-weight:500;white-space:pre-wrap;">${html}</p>`;
    })
    .join("");
}

function transcriptBubblesHtml(brandKey, session) {
  const b = brandOf(brandKey);
  return displayMessages(session)
    .map((m) => {
      const isClient = m.who === "client";
      const text = escapeHtml(m.text).replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>");
      return `<div style="text-align:${isClient ? "right" : "left"};margin:0 0 14px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${isClient ? "#5b6878" : b.accent};margin-bottom:4px;">${isClient ? escapeHtml(session.name || "Client") : "Jessi"}</div>
        <div style="display:inline-block;max-width:82%;padding:12px 16px;border-radius:16px;background:${isClient ? b.navy : b.bubble};color:${isClient ? "#FFFFFF" : b.navy};font-size:14px;line-height:1.5;text-align:left;">${text}</div>
      </div>`;
    })
    .join("");
}

function fromAddress(brandKey) {
  const addr = process.env.FROM_EMAIL_ADDRESS || "noreply@havenbuiltmedia.com";
  return `${brandOf(brandKey).fromName} <${addr}>`;
}

async function sendEmail({ brand, to, subject, html, text, attachments, replyTo }) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  const body = { from: fromAddress(brand), to: [].concat(to), subject, html, text };
  if (attachments && attachments.length) body.attachments = attachments;
  const reply = replyTo || process.env.REPLY_TO_EMAIL;
  if (reply) body.reply_to = reply;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return true;
}

function resumeLink(session) {
  return `${siteUrl()}/?s=${encodeURIComponent(session.token)}`;
}

async function sendResumeEmail(session, { returning } = {}) {
  const first = String(session.name || "").trim().split(/\s+/)[0] || "there";
  const link = resumeLink(session);
  const intro = returning
    ? `Hi ${escapeHtml(first)}, here's your link to pick our conversation back up right where you left off.`
    : `Hi ${escapeHtml(first)}, thanks for starting our pre-shoot conversation. If you need to step away, this link brings you right back to where you left off, on any device.`;
  const html = emailShell(
    session.brand,
    para(session.brand, intro) +
      button(session.brand, link, "Pick up where you left off") +
      para(session.brand, `<span style="font-size:13px;color:#5b6878;">Keep this email handy. Anyone with this link can open your conversation, so it's best not to forward it.</span>`),
    "Your link to pick up our pre-shoot conversation"
  );
  const text = `${intro.replace(/<[^>]+>/g, "")}\n\n${link}\n\nKeep this email handy. Anyone with this link can open your conversation, so it's best not to forward it.`;
  return sendEmail({ brand: session.brand, to: session.email, subject: "Your pre-shoot conversation with Jessi", html, text });
}

// ---------------------------------------------------------------------------
// PDF of the conversation (for the client)
// ---------------------------------------------------------------------------

// Standard PDF fonts only cover WinAnsi; drop anything else (emoji etc.)
// rather than render garbage.
function pdfSafe(s) {
  return String(s || "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, "")
    .replace(/[ \t]+\n/g, "\n");
}

function findAsset(rel) {
  const candidates = [
    path.resolve(rel),
    path.join(process.cwd(), rel),
    path.join(__dirname, rel),
    path.join(__dirname, "..", rel),
    path.join(__dirname, "..", "..", rel),
    process.env.LAMBDA_TASK_ROOT ? path.join(process.env.LAMBDA_TASK_ROOT, rel) : null,
  ].filter(Boolean);
  return candidates.find((p) => {
    try { return fs.existsSync(p); } catch (e) { return false; }
  });
}

function buildConversationPdf(session) {
  const PDFDocument = require("pdfkit");
  const b = brandOf(session.brand);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 54, bottom: 60, left: 54, right: 54 }, bufferPages: true });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width;
    const M = 54;
    const TW = W - M * 2;

    doc.rect(0, 0, W, 100).fill(b.navy);
    const logo = findAsset(path.join("public", b.logo));
    if (logo) {
      try { doc.image(logo, W - M - 130, 28, { fit: [130, 46], align: "right" }); } catch (e) { /* skip logo */ }
    }
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(9).text("PRE-SHOOT CONVERSATION", M, 34, { characterSpacing: 1.5 });
    doc.fontSize(18).text(pdfSafe(session.business || session.name || "Your conversation"), M, 52, { width: TW - 150, lineBreak: false, ellipsis: true });

    const date = new Date(session.completedAt || session.updatedAt || Date.now()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
    const meta = [session.name, session.shoot, date].filter(Boolean).map(pdfSafe).join("   |   ");
    doc.fillColor("#5b6878").font("Helvetica").fontSize(10).text(meta, M, 124, { width: TW });

    doc.moveDown(1.2);
    const boxY = doc.y;
    doc.font("Helvetica-Bold").fontSize(10);
    const nextCopy = "What happens next: I'll review everything you shared and come back to you with a plan for the shoot, including what we'll capture and where each piece will live.";
    const boxH = doc.heightOfString(nextCopy, { width: TW - 32 }) + 28;
    doc.roundedRect(M, boxY, TW, boxH, 10).fill(b.soft);
    doc.fillColor(b.navy).text(nextCopy, M + 16, boxY + 14, { width: TW - 32 });
    doc.y = boxY + boxH + 24;

    displayMessages(session).forEach((m) => {
      const isClient = m.who === "client";
      const label = isClient ? pdfSafe(session.name || "You") : "Jessi";
      const body = pdfSafe(plainText(m.text));
      doc.font("Helvetica").fontSize(10.5);
      const h = doc.heightOfString(body, { width: TW }) + 22;
      if (doc.y + Math.min(h, 120) > doc.page.height - 70) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(isClient ? "#5b6878" : b.accent).text(label.toUpperCase(), M, doc.y, { characterSpacing: 1 });
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(10.5).fillColor(b.navy).text(body, M, doc.y, { width: TW, lineGap: 2 });
      doc.moveDown(1);
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(8.5).fillColor("#8a94a2");
      doc.text(`${b.name}  |  Questions? Text Jessi at 630-965-6827`, M, doc.page.height - 36, { width: TW - 60, lineBreak: false });
      doc.text(`${i + 1} / ${range.count}`, W - M - 60, doc.page.height - 36, { width: 60, align: "right", lineBreak: false });
      doc.page.margins.bottom = prevBottom;
    }
    doc.end();
  });
}

module.exports = {
  MODEL,
  MAX_MESSAGES,
  MAX_USER_CHARS,
  BRANDS,
  PHASES,
  EMAIL_RE,
  brandOf,
  siteUrl,
  systemPrompt,
  openingMessage,
  BRIEF_SYSTEM_PROMPT,
  parseTags,
  contentToText,
  displayMessages,
  plainText,
  transcriptText,
  connectBlobs,
  sessionsStore,
  emailIndexStore,
  emailKey,
  newToken,
  validToken,
  loadSession,
  saveSession,
  jsonResponse,
  escapeHtml,
  emailShell,
  para,
  button,
  briefBodyHtml,
  transcriptBubblesHtml,
  sendEmail,
  sendResumeEmail,
  resumeLink,
  buildConversationPdf,
};
