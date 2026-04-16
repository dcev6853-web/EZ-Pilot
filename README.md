# EZ Pilot — Production AI Agent Platform

**Domain:** `https://ez-pilot.com`
**Stack:** Node.js · TypeScript · Express · Firebase · Firestore · 9 AI Providers

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (static)                     │
│  index.html · ez-pilot.html · ez-pilot-mobile.html      │
│  Firebase Auth (email, phone OTP, Google, Microsoft)     │
│  Calls /api/task with Bearer token                       │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────┐
│                  BACKEND (Node.js/Express)                │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ Auth MW  │→│ Rate Lim │→│  Routes   │               │
│  │ (Firebase│  │ (per-user│  │ /api/task │               │
│  │  + JWT)  │  │  + IP)   │  │ /api/chat │               │
│  └──────────┘  └──────────┘  └────┬─────┘               │
│                                    │                     │
│  ┌─────────────────────────────────▼──────────────────┐  │
│  │               AGENT BRAIN (brain.ts)               │  │
│  │  1. Parse user goal                                │  │
│  │  2. Load memory + context                          │  │
│  │  3. Ask AI → get structured JSON                   │  │
│  │  4. Validate tool params                           │  │
│  │  5. Execute tool (with safety tier)                │  │
│  │  6. Feed result back → repeat (max 6 iterations)   │  │
│  │  7. Return response + pending confirmations        │  │
│  │                                                    │  │
│  │  Retry: 2 retries if AI returns bad JSON           │  │
│  │  Context: trimmed to 8000 chars max                │  │
│  │  Cost: tracks tokens per run                       │  │
│  └──────────────────────┬─────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────▼──────────────────────────────┐ │
│  │              TOOL REGISTRY (registry.ts)            │ │
│  │                                                     │ │
│  │  🟢 AUTO (safe — runs immediately)                  │ │
│  │    create_task · update_budget · save_memory         │ │
│  │    fetch_memory · search_web                        │ │
│  │                                                     │ │
│  │  🟡 DRAFT_CONFIRM (AI drafts, user approves)        │ │
│  │    draft_email_reply · draft_message_reply           │ │
│  │                                                     │ │
│  │  🔴 MANUAL_ONLY (NEVER auto-executes)               │ │
│  │    make_payment                                     │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │                                │
│  ┌──────────────────────▼──────────────────────────────┐ │
│  │              ASYNC QUEUE (queue.ts)                 │ │
│  │  Firestore-based job queue for background tasks     │ │
│  │  Processes: cron triggers, webhooks, events         │ │
│  │  Cleanup: auto-purge jobs older than 7 days         │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │ Scheduler (1-min tick)                               ││
│  │  · Process pending queue jobs (batch of 3)           ││
│  │  · Check user cron triggers → enqueue matching       ││
│  │  · Daily 3 AM cleanup of old completed/failed jobs   ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                    FIRESTORE                             │
│                                                          │
│  users/{uid}/                                            │
│    ├── tasks/         (auto-created + manual)            │
│    ├── budget/        (income + expense entries)          │
│    ├── drafts/        (pending email/message drafts)     │
│    ├── pending_actions/ (payments awaiting confirmation) │
│    ├── memory/        (key-value facts + preferences)    │
│    ├── agent_runs/    (full step logs — AI Work Log)     │
│    ├── integrations/  (OAuth tokens + status)            │
│    ├── chat_log/      (legacy direct chat)               │
│    ├── cron_jobs/     (user-defined scheduled tasks)     │
│    ├── trigger_log/   (all trigger events)               │
│    └── files/         (uploaded file metadata)            │
│                                                          │
│  job_queue/           (async background jobs)            │
└──────────────────────────────────────────────────────────┘
```

---

## Security Checklist (Point #1)

| Check | Status |
|---|---|
| API keys NEVER in frontend | ✅ All AI keys server-side only. Frontend has only Firebase public config. |
| Rate limiting | ✅ 120/min global, 10/15min auth, 30/min chat per user |
| Auth on every API call | ✅ `authMiddleware` verifies Firebase ID token or JWT on all `/api/*` routes |
| Input validation | ✅ Zod schemas on every controller: task, chat, auth, upload, webhook, confirm |
| Helmet security headers | ✅ CSP, HSTS preload, X-Frame deny, X-Content-Type nosniff |
| CORS restricted | ✅ Only `ez-pilot.com` origin allowed |
| Password hashing | ✅ Firebase Auth handles this (bcrypt-equivalent, Google infrastructure) |

---

## Deterministic AI Output (Point #2)

The agent brain enforces structured JSON:
1. System prompt demands JSON-only responses
2. `parseAIResponse()` strips markdown fences, finds JSON boundaries
3. Validates `action` field exists and is a string
4. If parsing fails → retries up to 2 times, explicitly telling AI to fix its format
5. Tool parameters validated BEFORE execution — missing required params trigger a fix prompt
6. If all retries fail → returns raw text as graceful fallback (no crash)

---

## Async Task Handling (Point #3)

`services/agent/queue.ts` implements a Firestore-based job queue:
- `enqueueTask()` — add a job with `status: 'pending'`
- `processQueue(batchSize)` — picks pending jobs, runs agent, marks completed/failed
- Scheduler processes 3 jobs per minute tick
- Used for: cron triggers, webhook-triggered automation, background heartbeats
- Upgrade path: swap to BullMQ + Redis when >100 concurrent jobs

---

## Tool Safety (Point #4)

Every tool has an explicit `safetyTier`:
- **auto** — executes immediately, no confirmation (tasks, budgets, memory)
- **draft_confirm** — AI creates a draft in Firestore, user must approve via `/api/task/confirm`
- **manual_only** — creates a `pending_action` record, NEVER auto-executes (payments)

Parameter validation runs BEFORE execution. Unknown tools are rejected.

---

## Context Management (Point #5)

- Memory stored in Firestore (`memory/{key}`), NOT in the prompt permanently
- Only relevant context injected per run: memory + last 3 actions + live data
- Total context trimmed to 8000 chars max (`trimContext()`) — keeps 30% head + 70% tail
- Old conversations NOT carried forward — each `/api/task` call gets fresh context

---

## Logging (Point #6)

Every agent run is logged to `agent_runs/{runId}`:
- User message
- AI model used
- Every step: thought, action, input, output, success, duration
- Pending confirmations
- Total tokens used
- Total duration
- Timestamp

Backend logger (pino) also logs: tool executions, queue processing, auth events, errors.

---

## Cost Control (Point #7)

| Control | Implementation |
|---|---|
| Per-user quotas | `quota.service.ts`: Pro 20 agent/12h + 10 advanced/12h, Max unlimited |
| Model fallback | `router.service.ts`: if primary model fails → auto-fallback to Claude Sonnet 4.6 (cheapest) |
| Token tracking | Each agent run tracks `totalTokens` |
| Max iterations | Agent loop capped at 6 iterations per run |
| Context trimming | 8000 char max prevents bloated prompts (saves tokens) |

---

## Separation of Layers (Point #8)

```
src/
├── config/          # env, firebase, redis, logger — pure config, no logic
├── middleware/       # auth, errors, rate limit — cross-cutting concerns
├── controllers/     # HTTP handlers — parse request, call service, format response
├── routes/          # URL → controller mapping, middleware chains
├── services/
│   ├── agent/       # brain.ts (decision loop), queue.ts (async jobs)
│   ├── ai/          # 7 provider SDKs + router + context builder
│   ├── tools/       # registry.ts (8 tools with safety tiers)
│   ├── memory/      # memory.service.ts (Firestore key-value store)
│   ├── billing/     # quota.service.ts (plan enforcement)
│   └── triggers/    # dispatcher.ts (10 trigger types), scheduler.ts (cron + queue)
```

No controller calls AI directly. No tool accesses HTTP. No service knows about Express.

---

## Real Agent Behavior (Point #9)

The agent loop in `brain.ts` is a true autonomous decision system:

1. **Goal**: user sends natural language goal
2. **Planning**: AI reads tools + context → decides which tool to use (structured JSON)
3. **Execution**: tool runs → result returned
4. **Feedback**: result fed back to AI → AI decides next step or responds
5. **Stopping**: when AI returns `{"action":"respond",...}` or hits 6 iterations
6. **Memory**: preferences saved via `save_memory` tool, recalled on next run

This is NOT a chatbot. The AI actively plans and executes multi-step workflows.

---

## Scaling Path (Point #10)

| Phase | What to add |
|---|---|
| Now (MVP) | Current system: single agent, Firestore queue, 8 tools |
| 500 users | BullMQ + Redis queue (replace Firestore queue) |
| 2000 users | Separate worker process for queue (not same server as API) |
| 5000 users | Multi-agent: specialized agents (email agent, budget agent, ads agent) |
| 10000 users | Vector database for advanced memory (Pinecone/Weaviate) |
| 50000+ users | Tool marketplace (user-contributed tools), plugin system |

---

## API Endpoints

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/task` | ✅ | Send goal → agent runs → returns result |
| `POST` | `/api/task/confirm` | ✅ | Approve/reject a draft or pending action |
| `GET` | `/api/task/history` | ✅ | AI Work Log (past runs with steps) |
| `GET` | `/api/task/drafts` | ✅ | Pending drafts + actions |
| `POST` | `/api/chat` | ✅ | Direct AI chat (no tools, legacy) |
| `POST` | `/api/upload` | ✅ | File upload (Firebase Storage) |
| `POST` | `/api/integrations/verify` | ✅ | Check OAuth token health |
| `GET` | `/api/integrations` | ✅ | List connected services |
| `POST` | `/api/auth/signup` | — | Create account |
| `POST` | `/api/auth/login` | — | Sign in |
| `GET` | `/api/auth/oauth/:provider` | — | Start OAuth flow |
| `POST` | `/api/webhooks/stripe` | sig | Stripe events |
| `POST` | `/api/webhooks/trigger` | secret | Inbound trigger from Make.com |
| `GET` | `/api/health` | — | Health check |

---

## Deploy — Full Step-by-Step Guide

### Step 1: Firebase Setup

```bash
# Install Firebase CLI
npm install -g firebase-tools
firebase login
```

1. Go to [Firebase Console](https://console.firebase.google.com/) → Create project "ez-pilot"
2. **Authentication → Sign-in method** → Enable:
   - Email/Password
   - Phone (set allowed regions → allow US at minimum)
   - Google (paste your OAuth client ID: `830406008027-...`)
   - Microsoft (App ID: `29bfc578-657a-4905-bfb4-953c470c532f`, Secret: `2543a53d-...`)
3. **Authentication → Settings → Authorized domains** → Add `ez-pilot.com` and `www.ez-pilot.com`
4. **Firestore Database** → Create database (production mode) → Location: `us-central1`
5. **Storage** → Create bucket → Default rules
6. **Project Settings → General → Your apps** → Click "Web" → Register app → Copy config:
   ```js
   apiKey: "AIza...",
   authDomain: "ez-pilot.firebaseapp.com",
   projectId: "ez-pilot",
   storageBucket: "ez-pilot.appspot.com",
   messagingSenderId: "830406008027",
   appId: "1:830406008027:web:..."
   ```
7. Paste `apiKey` and `appId` into `ez-pilot.html` and `ez-pilot-mobile.html` where it says `REPLACE_WITH_YOUR_FIREBASE_API_KEY` and `REPLACE_WITH_YOUR_FIREBASE_APP_ID`
8. **Project Settings → Service accounts** → Generate new private key → Download JSON → You'll need `client_email` and `private_key` for the backend `.env`

Deploy Firestore + Storage rules:
```bash
firebase deploy --only firestore:rules,storage:rules
```

### Step 2: Get AI Provider API Keys

You need at least ONE key to start. Get more as you scale:

| Provider | Get key at | Env var |
|---|---|---|
| Anthropic (Claude) | https://console.anthropic.com | `ANTHROPIC_API_KEY` |
| OpenAI (GPT-5, GPT-4, o1) | https://platform.openai.com | `OPENAI_API_KEY` |
| Google (Gemini) | https://aistudio.google.com | `GOOGLE_API_KEY` |
| xAI (Grok) | https://console.x.ai | `XAI_API_KEY` |
| DeepSeek | https://platform.deepseek.com | `DEEPSEEK_API_KEY` |
| Mistral | https://console.mistral.ai | `MISTRAL_API_KEY` |
| Perplexity | https://perplexity.ai | `PERPLEXITY_API_KEY` |

Minimum to start: just `ANTHROPIC_API_KEY` (Claude Sonnet is the fallback model for everything).

### Step 3: Database (PostgreSQL)

Choose one (all have free tiers):
- **Supabase** → https://supabase.com → New project → Copy `DATABASE_URL` from Settings → Database
- **Neon** → https://neon.tech → New project → Copy connection string
- **Railway** → https://railway.app → Add PostgreSQL → Copy `DATABASE_URL`

### Step 4: Redis

Choose one:
- **Upstash** → https://upstash.com → Create Redis database → Copy `REDIS_URL`
- **Railway** → Add Redis → Copy URL

### Step 5: Backend Deploy

#### Option A: Render.com (recommended — free tier available)

1. Push your `backend/` folder to a GitHub repo
2. Go to https://render.com → New Web Service → Connect repo
3. Settings:
   - Build command: `npm install && npm run build && npx prisma generate`
   - Start command: `npm start`
   - Environment: `Node`
4. Add ALL env vars from `.env.example` in the Environment tab
5. Deploy → Get URL like `https://ez-pilot-api.onrender.com`

#### Option B: Railway.app

1. Push to GitHub
2. Railway → New project → Deploy from GitHub
3. Add env vars
4. Railway auto-detects Node.js and deploys
5. Get URL like `https://ez-pilot-api.up.railway.app`

#### Option C: Docker (any VPS — DigitalOcean, AWS, etc.)

```bash
cd backend
cp .env.example .env
# Fill in ALL keys in .env (see .env.example for full list)

# Build and run
docker build -t ez-pilot-api .
docker run -d \
  --name ez-pilot-api \
  --env-file .env \
  -p 5000:5000 \
  --restart unless-stopped \
  ez-pilot-api
```

#### Option D: Local development

```bash
cd backend
cp .env.example .env
# Fill in keys

npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
# Server runs on http://localhost:5000
```

### Step 6: Stripe Setup

1. Go to https://dashboard.stripe.com → Developers → API keys
2. Copy **Secret key** → paste as `STRIPE_SECRET_KEY` in backend `.env`
3. Developers → Webhooks → Add endpoint:
   - URL: `https://your-backend-url.com/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`
4. Copy **Webhook signing secret** → paste as `STRIPE_WEBHOOK_SECRET`

Your payment links are already configured:
- Starter: `https://buy.stripe.com/00w14o6q1cY3aU48j7ffy08`
- Pro Monthly: `https://buy.stripe.com/8x26oIaGhcY37HS42Rffy06`
- Pro Annual: `https://buy.stripe.com/cNicN67u54rx3rC2YNffy04`
- Max Monthly: `https://buy.stripe.com/4gMeVeaGh3ntbY8bvjffy07`
- Max Annual: `https://buy.stripe.com/dRmfZiaGhgaf0fq1UJffy03`

### Step 7: Frontend Deploy

#### Vercel (recommended)

```bash
# From the root (not backend/)
npx vercel
# Follow prompts → deployed to https://ez-pilot.vercel.app
```

Or connect GitHub repo to Vercel dashboard → auto-deploys on push.

#### Netlify

```bash
npx netlify deploy --prod --dir=.
```

Or drag-and-drop the folder in Netlify dashboard.

#### Cloudflare Pages

```bash
npx wrangler pages deploy .
```

**Important:** Upload the entire root folder INCLUDING:
- All `.html` files
- `logos/` folder (29 brand icons)
- `*.pdf` files (terms + privacy)
- `_headers` file (if using Netlify/CF Pages)

### Step 8: DNS + SSL

Add these DNS records at your domain registrar:

```
Type    Name    Value
A       @       <frontend-host-IP>   (or CNAME to vercel/netlify)
CNAME   www     ez-pilot.com
CNAME   api     <backend-host>       (e.g. ez-pilot-api.onrender.com)
```

SSL is auto-provisioned on Vercel, Netlify, Render, Railway, and Cloudflare. No manual setup needed.

### Step 9: Connect Frontend → Backend

In `ez-pilot.html`, the chat/task endpoints call `/api/task`. If your backend is on a different domain (e.g. `api.ez-pilot.com`), update the fetch URLs:

```js
// In the sendMsg() function, change:
fetch('/api/task', ...)
// to:
fetch('https://api.ez-pilot.com/api/task', ...)
```

Or set up a reverse proxy in `vercel.json`:
```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://api.ez-pilot.com/api/:path*" }
  ]
}
```

### Step 10: Verify Everything Works

```bash
# Health check
curl https://api.ez-pilot.com/api/health
# Should return: {"status":"ok","ts":...,"version":"2.0.0"}

# Test sign up (from browser)
# 1. Open https://ez-pilot.com
# 2. Click "Try free →"
# 3. Sign up with email + password
# 4. Should see payment gate
# 5. Pick a plan → redirects to Stripe

# Test admin access
# Sign up with kateljj68@gmail.com → should skip payment gate entirely
```

### Env Vars Checklist (backend .env)

Copy from `.env.example` and fill in:

```
# REQUIRED (won't start without these)
JWT_SECRET=<64+ random chars>
COOKIE_SECRET=<64+ random chars>
DATABASE_URL=postgresql://...
FIREBASE_PROJECT_ID=ez-pilot
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@ez-pilot.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
FIREBASE_STORAGE_BUCKET=ez-pilot.appspot.com

# REQUIRED (at least one AI key — Claude recommended)
ANTHROPIC_API_KEY=sk-ant-...

# RECOMMENDED
REDIS_URL=redis://...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# OPTIONAL (add as you enable more models)
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
XAI_API_KEY=xai-...
DEEPSEEK_API_KEY=sk-...
MISTRAL_API_KEY=...
PERPLEXITY_API_KEY=pplx-...
```

---

## Contact

`dcev6853@gmail.com` · `https://ez-pilot.com`
