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

## Deploy

```bash
cd backend
cp .env.example .env   # fill in all keys
npm install
npm run dev            # development
# or
docker build -t ez-pilot-api .
docker run -p 5000:5000 --env-file .env ez-pilot-api
```

Frontend: deploy all HTML + `logos/` folder to Vercel/Netlify/Cloudflare Pages.

---

## Contact

`dcev6853@gmail.com` · `https://ez-pilot.com`
