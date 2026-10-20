# Shoot With Purpose

A pre-shoot strategy conversation for TWTF and HBM content shoots. It's not a form: the client talks it out with "Jessi" (the bot, in Jessi's voice) about what's changing in their business, what's coming up, their #1 goal, where their marketing feels thin, where the photos and videos will actually live, who they're for, what they already have, and how they feel on camera.

Rule behind it: **no shot without a home.** Every frame should have a job before the camera comes out.

Not for brand story videos. That's Legacy Lucy / Story to Legacy.

## What happens

1. **Client opens the link** and enters their name and email. HBM is the default look and voice. Add `?brand=twtf` for TWTF. Their business name comes up in the chat, not the form.
2. **Everything saves after every message.** On the same device it just reopens. On a new device they enter the same name and email and land right where they left off.
3. **Same email, different name** is blocked with a friendly note to text you. **A client whose last conversation is finished** (like a repeat client's next shoot) starts a fresh one; the old one stays in the archive.
4. **They chat.** One question at a time, with follow-ups that dig a level deeper, reflections back, and room to brain dump. They can attach screenshots, PDFs or text files. The 4-segment bar at the top tracks progress (change → goal → gaps → people).
5. **When it wraps**, you get an email with a **strategy brief** (the job of the shoot, the gaps, where it will live, a content map starter, quotes in their words, and things to watch for) plus the full conversation. Reply-to is set to the client.
6. **"Send me a PDF"** on the finish screen emails the client a branded PDF of the conversation. It never includes your brief.
7. **Everything is archived** at `/admin.html`, in progress and finished, with filters for brand and status.

## Links to send

| Who | Link |
|---|---|
| HBM client | `https://YOUR-SITE.netlify.app/` |
| TWTF client | `https://YOUR-SITE.netlify.app/?brand=twtf` |
| Named shoot (shows up in the chat and the PDF) | add `&shoot=HERO%20Session%20on%20Nov%209` |
| Prefill their details | add `&name=Becky%20Reel&email=becky@...` (add `&business=...` to skip asking for it) |

Example: `https://YOUR-SITE.netlify.app/?shoot=HERO%20Session%20on%20Nov%209&name=Becky%20Reel&business=Reel%20Home%20Care%20Consulting`

## Deploy (Netlify)

1. Netlify → **Add new site → Import an existing project** → pick this repo. Build settings come from `netlify.toml` (static `public/` folder + functions, no build command).
2. **Site configuration → Environment variables**:
   - `ANTHROPIC_API_KEY` (required)
   - `RESEND_API_KEY` (required: client PDF and your brief)
   - `FROM_EMAIL_ADDRESS` (an address on your verified Resend domain, e.g. `noreply@havenbuiltmedia.com`; the sender name switches between "Jessi at Haven Built Media" and "Jessi at This Way to Fabulous" automatically)
   - `BRIEF_TO_EMAIL` (where your briefs go)
   - `ADMIN_TOKEN` (any long random string, for `/admin.html`)
   - Optional: `REPLY_TO_EMAIL`, `MODEL`
3. Deploy. Netlify Blobs (where conversations are stored) needs no setup.

## Live dashboard

Conversations feed the TWTF Live Dashboard (submission-dashboard.netlify.app) as **HBM Pre-Shoot Prep** and **TWTF Pre-Shoot Prep**, with the strategy brief shown above each conversation. The dashboard calls `/.netlify/functions/store` with this site's `ADMIN_TOKEN`. On the dashboard site, set `SHOOT_PREP_URL` (this site's URL) and `SHOOT_PREP_CODE` (this site's `ADMIN_TOKEN`).

## Header graphic

Same size as the Wizard and Brand Therapy banners: **1280 x 420 px**. Save them as `public/assets/hbm-header.png` and `public/assets/twtf-header.png`, push, and they replace the navy logo band automatically. Keep the important stuff out of the far edges; it scales down on phones.

## Editing later

- **How the bot talks**: `netlify/functions/_shared.js` → `systemPrompt()` (topics, rules, voice) and `VOICE` (HBM vs TWTF tone).
- **The opening message**: `openingMessage()` in the same file.
- **Your brief format**: `BRIEF_SYSTEM_PROMPT` in the same file.
- **Headline, intro and finish-screen copy**: `public/index.html` (HBM copy in the HTML, TWTF overrides in `applyBrand()`).
- **Colors**: CSS variables at the top of `public/index.html`; email/PDF colors in `BRANDS` in `_shared.js`.

Push to `main` and Netlify redeploys.

## Guardrails

- Max 90 messages per conversation and 12,000 characters per message so a runaway chat can't burn API credits.
- Attachments: up to 3 per message, 3MB each (images, PDF, text).
- The client PDF is resendable up to 5 times.
- The bot never builds the shot list, quotes prices, or promises deliverables. It tells the client you'll come back with a plan.

## Local dev

```
npm install
netlify dev
```

Needs the Netlify CLI and a `.env` (copy `.env.example`).
