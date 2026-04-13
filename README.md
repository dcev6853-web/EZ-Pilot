# EZ Pilot — Full Production Bundle

**Domain:** `https://ez-pilot.com`
**Status:** production-ready · Node 20+ · TypeScript · Firebase · PostgreSQL · Redis

---

## 📁 Bundle contents

### Frontend (static, deploy to Vercel / Netlify / Cloudflare Pages)
| File | Purpose |
|---|---|
| `index.html` | Public landing page |
| `ez-pilot.html` | Desktop app |
| `ez-pilot-mobile.html` | Mobile app |
| `terms.html` · `privacy.html` | Legal pages |
| `firebase-client.js` | Firebase Auth + Firestore client SDK |
| `_headers` · `netlify.toml` · `vercel.json` · `.htaccess` · `nginx.conf` | Hosting configs |

### Backend (`backend/`) — deploy to Render / Railway / Fly.io / any Docker host
| Path | Purpose |
|---|---|
| `src/server.ts` | Entry point + graceful shutdown |
| `src/app.ts` | Express app with Helmet, CORS, compression, CSP |
| `src/config/` | env (zod), Firebase, Redis, logger (pino) |
| `src/controllers/` | auth, chat, upload, integrations, webhooks |
| `src/routes/` | Route definitions with auth + rate limits |
| `src/middleware/` | auth (Firebase + JWT), error, rate limit |
| `src/services/ai/` | Router + 7 providers (Anthropic, OpenAI, Google, xAI, DeepSeek, Mistral, Perplexity) |
| `src/services/triggers/` | 10-type dispatcher + cron scheduler |
| `src/services/billing/` | Quota enforcement, Stripe |
| `prisma/schema.prisma` | Postgres schema (users, subscriptions, audit log) |
| `Dockerfile` | Multi-stage production image |
| `firestore.rules` · `storage.rules` | Per-user data isolation |

---

## 🚀 Deploy in 5 steps

### 1. Firebase
```bash
npm i -g firebase-tools
firebase login
firebase init   # Firestore + Storage + Authentication
firebase deploy --only firestore:rules,storage:rules
```
Download a service-account JSON from Project Settings → Service accounts.

### 2. Backend
```bash
cd backend
cp .env.example .env
# Fill in all keys (see .env.example for the full list)
npm install
npm run db:generate
npm run db:migrate
npm run dev    # local
# or: docker build -t ez-pilot-api . && docker run -p 5000:5000 --env-file .env ez-pilot-api
```

**Required env vars:**
- All 7 AI provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `PERPLEXITY_API_KEY`)
- `FIREBASE_*` (from service account)
- `DATABASE_URL` (Postgres — Supabase/Neon/Railway all work)
- `REDIS_URL` (Upstash or hosted Redis)
- `JWT_SECRET` + `COOKIE_SECRET` (64+ char random strings)
- `STRIPE_*` + price IDs for each plan
- `MAKE_WEBHOOK_URL_*` (from Make.com scenarios)
- OAuth client IDs for each ecosystem

### 3. Make.com
Create 3 scenarios with "Webhooks → Custom webhook" triggers:
- `chat-actions-webhook` → fires after every chat
- `triggers-webhook` → receives trigger events from any of the 10 types
- `tasks-webhook` → for auto-task creation

Each scenario routes to downstream apps (Google Docs, Gmail, TikTok Ads, etc.) via Router modules.

### 4. Frontend
Deploy the static files:
```bash
# Vercel
vercel

# or Netlify
netlify deploy --prod --dir=.

# or Cloudflare Pages
wrangler pages deploy .
```

Update the API URL in the frontend JS if your backend is on a separate subdomain (e.g. `api.ez-pilot.com`).

### 5. DNS + SSL
```
A     @    <frontend-host-IP>
CNAME www  ez-pilot.com
CNAME api  <backend-host>
```
SSL is auto-provisioned on all recommended hosts. Configs force HTTPS + HSTS preload.

---

## 🧩 10 Trigger Types

Every automation in EZ Pilot flows through one of these trigger types. They're all handled by `src/services/triggers/dispatcher.ts`:

| Type | Example | Source |
|---|---|---|
| `event` | New Gmail received | Gmail API webhook |
| `time` | Daily report at 9 AM | Cron scheduler |
| `webhook` | Stripe payment completed | Stripe webhook |
| `user` | "Create a campaign" | Dashboard chat |
| `ai_predicted` | Follow-up email suggestion | AI model |
| `threshold` | Ad budget exceeded | Google Ads metrics |
| `context` | Meeting scheduled | Google Calendar |
| `repository` | New pull request | GitHub webhook |
| `messaging` | Slack @mention | Slack Events API |
| `iot` | Temperature change | Smart home hub |

Each trigger writes to `/users/{uid}/trigger_log` and creates a pending task that the user validates before execution.

---

## 🤖 AI Provider Routing

| Model ID in picker | Provider | Official SDK/endpoint | Model string |
|---|---|---|---|
| Claude Opus 4.6 | Anthropic | `@anthropic-ai/sdk` | `claude-opus-4-6` |
| Claude Sonnet 4.6 | Anthropic | `@anthropic-ai/sdk` | `claude-sonnet-4-6` |
| GPT-5 | OpenAI | `openai` | `gpt-5` |
| OpenAI o1 | OpenAI | `openai` | `o1` |
| Gemini 2.5 Pro | Google | `@google/generative-ai` | `gemini-2.5-pro` |
| Grok 4 | xAI | `api.x.ai/v1/chat/completions` | `grok-4` |
| DeepSeek R2 | DeepSeek | `api.deepseek.com/v1/chat/completions` | `deepseek-reasoner` |
| Mistral Large | Mistral | `@mistralai/mistralai` | `mistral-large-latest` |
| Perplexity | Perplexity | `api.perplexity.ai/chat/completions` | `sonar-pro` |

If the primary model fails, the router falls back to Claude Sonnet 4.6 automatically.

---

## 💰 Pricing & Quotas (enforced server-side)

| Plan | Monthly | Annual | Agent/12h | Advanced AI/12h | Uploads/24h | Cancel |
|---|---|---|---|---|---|---|
| Pro | $23/mo | $19/mo ($228/yr) · **1-month free trial on annual only** | 20 | 10 | 15 | Annual = 12-mo commitment · Monthly = anytime (no trial) |
| Max | $100/mo | $90/mo ($1,080/yr) | ∞ | ∞ | ∞ | Annual = 12-mo commitment · Monthly = anytime |

All quotas enforced in `src/services/billing/quota.service.ts`.

---

## 🔐 Security

- **All API keys on the server.** Never in the browser.
- **Helmet** with strict CSP allowlisting only the 7 AI provider domains.
- **HSTS preload** ready (1-year max-age, includeSubDomains).
- **Rate limits:** 120 req/min global, 10 sign-in attempts per 15min per IP, 30 chat calls per min per user.
- **Firestore rules** isolate users to `/users/{their_uid}/*`.
- **Storage rules** cap uploads at 100 MB per file.
- **Terms acceptance** required on every login, versioned and stamped to user doc.
- **JWT + Firebase dual auth** — Firebase ID tokens (social) or JWT (email/password) both accepted.
- **bcrypt** for password hashing (cost 12).
- **libphonenumber-js** for E.164 phone validation.
- **Structured logging** with pino, secrets redacted automatically.

---

## 📧 Contact

`dcev6853@gmail.com` · `https://ez-pilot.com`
