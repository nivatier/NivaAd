---

## NivaSpark — AI Powered Digital Ad creation Tool

### What it is
B2B SaaS platform by Nivatier (Expo City Dubai). AI-generated social media ads — text, image and video — with scheduling and direct posting to LinkedIn, Facebook, Instagram, X, TikTok and Threads.

---

### Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy async, Pydantic v2 |
| Task queue | Celery + Redis |
| Database | PostgreSQL + Alembic migrations |
| Frontend | TanStack Start, React 19, Tailwind v4, TypeScript, Bun |
| AI/LLM | OpenRouter only (`OPENROUTER_BASE_URL` + `OPENROUTER_API_KEY`) |
| Storage | Cloudflare R2 (prod), MinIO (local) |
| Billing | Stripe (subscriptions + credit top-ups) |
| Email | AWS SES Tokyo region |

---

### Production Infrastructure

| Service | Platform | URL |
|---|---|---|
| `api` | Railway (Hobby) | `https://nivaad-production.up.railway.app` |
| `worker` | Railway (Hobby) | — |
| `beat` | Railway (Hobby) | — |
| `postgres` | Railway managed | internal |
| `redis` | Railway managed | internal |
| Frontend | Vercel | `https://spark.nivatier.com` |
| Media storage | Cloudflare R2 | `pub-28b9cc4889dd44749c08751b84f38326.r2.dev` |
| DNS | Cloudflare | `nivatier.com` |
| Developer panel | Vercel | `https://spark.nivatier.com/developer-login` |

Railway: 2 vCPU / 1 GB RAM per service. Hobby plan $5/month base. **Railway runs multiple API instances in parallel — race conditions that don't appear locally (single worker) can surface in production.**

---

### Production `.env` (Railway api service)

```env
ENV=production
DATABASE_URL=postgresql+asyncpg://postgres:...@sakura.proxy.rlwy.net:42692/railway
REDIS_URL=redis://...railway.app:6379
JWT_SECRET=<generated>
FERNET_KEY=<generated>
BACKEND_URL=https://nivaad-production.up.railway.app
FRONTEND_URL=https://spark.nivatier.com
ALLOWED_ORIGINS=https://spark.nivatier.com
S3_ENDPOINT_URL=https://0cb4531597ad34628bb5d0f1277e8aac.r2.cloudflarestorage.com
S3_PUBLIC_URL=https://pub-28b9cc4889dd44749c08751b84f38326.r2.dev
S3_BUCKET=nivaspark-media
S3_ACCESS_KEY=<r2 key>
S3_SECRET_KEY=<r2 secret>
SMTP_HOST=email-smtp.ap-northeast-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=AKIAYYTOYFDMGV3HQAMV
SMTP_PASSWORD=<ses password>
OPENROUTER_BASE_URL=<url>
OPENROUTER_API_KEY=<key>
STRIPE_SECRET_KEY=<key>
STRIPE_WEBHOOK_SECRET=<whsec_...>
RAILWAY_API_TOKEN=<token>
RAILWAY_PROJECT_ID=091cd956-092e-426b-aba7-0ffc13d6bc91
```

Worker needs all except SMTP. Beat needs only `DATABASE_URL`, `REDIS_URL`, `ENV`.

---

### Local Development Stack

Docker Compose from: `F:\MY WORKS\00-NIVATIER\00-PRODUCTS\02-NivaAd\`

| Service | Local URL |
|---|---|
| `api` | `http://localhost:8000` |
| `postgres` | `localhost:5433` |
| `redis` | `localhost:6379` |
| `minio` | `http://localhost:9000` |
| `minio console` | `http://localhost:9001` |
| `mailpit` | `http://localhost:8025` |

Frontend runs outside Docker:
```bash
cd frontend && npm run dev
# http://localhost:5173
# VITE_API_BASE_URL=http://localhost:8000
```

Worker start command (local + Railway):
```
celery -A app.worker.celery_app worker --loglevel=info --concurrency=4 --queues=generation,posting,default
```

### Local `.env`
```env
ENV=development
DATABASE_URL=postgresql+asyncpg://nivaad:nivaad_dev@postgres:5432/nivaad
REDIS_URL=redis://redis:6379/0
S3_ENDPOINT_URL=http://minio:9000
S3_PUBLIC_URL=http://localhost:9000/nivaad-media
S3_BUCKET=nivaad-media
S3_ACCESS_KEY=nivaad
S3_SECRET_KEY=nivaad_dev_secret
SMTP_HOST=mailpit
SMTP_PORT=1025
MOCK_POSTING=true
BACKEND_URL=http://localhost:8000
VITE_API_BASE_URL=http://localhost:8000
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Common commands
```bash
docker compose up --build -d
docker compose exec api alembic upgrade heads    # "heads" not "head" — handles multiple branch tips
docker compose logs -f api
docker compose logs -f worker
docker compose exec postgres psql -U nivaad -d nivaad
# Inside Railway postgres: psql $DATABASE_URL
```

---

### Key Architecture Rules

- **`ModelConfig` table** — always use `get_config_row(db, "topic")`, never `db.get(ModelConfig, 1)`
- **S3 URLs**: production R2 bucket NOT in path, local MinIO bucket IN path — `upload_bytes()` handles both
- **Celery `worker` and `beat`** are separate Railway services, same Dockerfile, different start commands
- **Frontend uses TanStack Start with SSR** — never access `document`, `window` or `localStorage` without a `useState(false)` + `useEffect` guard
- **localStorage in SSR**: wrap reads in `useState` + `useEffect`. Never call `localStorage` at module level or in render functions.
- **Notification fetch in `app-shell.tsx`**: tokens are stored in `sessionStorage` under key `nivaad_tokens` as JSON `{ access_token: "..." }` — NOT `localStorage.getItem("token")`. Use `getAuthToken()` helper in app-shell.
- **API base URL in app-shell**: use `VITE_API_BASE_URL` env var (not `/api/...` relative URLs) — the frontend dev server doesn't proxy to the backend.
- **Page wrapper** uses `overflowX: "clip"` not `overflow-x-hidden`
- **All modals** use Radix Dialog (`@radix-ui/react-dialog`) — SSR-safe, no raw `createPortal`
- **Glass UI pattern**: `background: oklch(1 0 0 / 0.05)`, `backdropFilter: blur(20px) saturate(1.5)`, `border: 1px solid oklch(1 0 0 / 0.12)`, inset top highlight `inset 0 1px 0 oklch(1 0 0 / 0.16)`
- **Brand gold**: `oklch(0.85 0.18 52)` / hex `#E8B84B`
- **Credits**: stored in `CreditLedger` table as ledger deltas — `Company` model has NO `.credits` field. Always query `SELECT SUM(delta) FROM credit_ledger WHERE company_id = ?` or use `credit_svc.balance()` (async) / raw sync sum for Celery tasks.
- **LLM responses that return JSON arrays**: use `httpx.AsyncClient` directly, extract with `raw[raw.find("["):raw.rfind("]")+1]`
- **LLM responses that return plain text**: use `httpx.AsyncClient` directly, read `.get("content", "")`

---

### Celery Queue Architecture

Three queues — tasks routed in `worker.py`:

| Queue | Tasks | Purpose |
|---|---|---|
| `generation` | `generate_ad`, `generate_campaign_ad_image`, `edit_ad_image` | AI text + image generation (20–90s each) |
| `posting` | `post_ad_now` | Social platform API calls (2–10s) |
| `default` | All beat orchestrators | Fast dispatchers — find due work, fan out, exit |

**Beat schedule** (all in `worker.py`):
- `fire_due_scheduled_posts` — every 5 min — finds `ScheduledPost` rows due and fans to `posting` queue
- `post_due_streak_ads` — every 5 min — finds generated streak ads due and fans to `posting` queue
- `process_rss_feeds` — every 5 min — finds RSS subscriptions due (by `next_run_at`) and fans to `generation` queue
- `generate_due_streak_ads` — every hour at :10 — finds streak ads due in next 24h and fans to `generation` queue
- `check_agent_events` — daily 5AM UTC — recurring events
- `check_rss_feed_health` — daily 6AM UTC

**Railway scaling recipe:**
- Start: 1 worker `--queues=generation,posting,default --concurrency=4`
- Growing: add replica in Railway → same command, Railway load-balances automatically
- At scale: split workers by queue — dedicated `--queues=posting,default` + dedicated `--queues=generation`
- Hobby plan: 1 replica only. Pro plan needed for multiple replicas.

**Important**: always restart `beat` service after changing beat schedule — beat caches its schedule in `celerybeat-schedule`.

---

### Alembic Migration Chain (latest)

```
4394d363aa27  initial schema
...
v2w3x4y5z6a7  add developer_status to flagged_content
w3x4y5z6a7b8  add rss feed tables
x4y5z6a7b8c9  add rss feed health check columns
y5z6a7b8c9d0  add image_prompt to agent_recommendations
z6a7b8c9d0e1  add post_hour to rss_feed_subscriptions
a1b2c3d4e5f6  add website_streaks and streak_ads tables
b2c3d4e5f6a7  add generation_error to website_streaks
c3d4e5f6a7b8  add post_minute to rss_feed_subscriptions
d4e5f6a7b8c9  add generate_lead_minutes + generate_hour + generate_minute to rss_feed_subscriptions
e5f6a7b8c9d0  add include_logo to rss_feed_subscriptions
e6f7a8b9c0d1  add ref_id to notifications
```

Always run `alembic upgrade heads` (plural) after deploying — handles multiple branch tips gracefully.

---

### Agent Niva — 5 Tabs

Tab routing: `/app/agent-niva?tab=<key>`

| Tab key | Label |
|---|---|
| `quick-spark` | 💡 Quick Spark |
| `rss` | 📰 RSS Feeds |
| `streak` | 🚀 Brand Campaign Streak |
| `website-spark` | 🌐 Website Spark |
| `events` | 📅 Recurring Events |

Route uses `validateSearch` to type and parse the `tab` param. Tab state is driven purely from `Route.useSearch()` — no local `useState` for tab.

---

### Agent Niva — RSS Feed Feature (detailed)

**DB columns on `rss_feed_subscriptions`:**
- `post_hour` / `post_minute` — UTC time to POST the ad
- `generate_lead_minutes` — UI control: 15/30/45/60 min before post time (user-facing dropdown)
- `generate_hour` / `generate_minute` — pre-computed UTC generate time (post_time − lead_minutes), stored for fast beat query
- `include_logo` — bool, whether to composite brand logo on generated images (default true)
- `next_run_at` — tracks the next GENERATION time (not post time)

**Generation → Posting flow (auto-post mode):**
1. Beat fires `process_rss_feeds` every 5 min → finds subscriptions where `next_run_at <= now`
2. `next_run_at` advanced immediately at start of `_process_one_subscription` (prevents double-processing)
3. `generate_ad` dispatched to `generation` queue with headers: `rss_auto_post=1`, `rss_company_id`, `rss_ad_id`, `rss_platforms`, `rss_scheduled_at`
4. On completion, `_on_rss_generate_done` signal creates `ScheduledPost` rows at `post_hour:post_minute` (same day; if past, next day)
5. `fire_due_scheduled_posts` (every 5 min) picks up the `ScheduledPost` and dispatches `post_ad_now` to `posting` queue

**Generation → Draft flow (manual approval mode):**
1. Same beat/generation path
2. On completion, `_on_rss_generate_done` creates `RssFeedDraft` + `Notification` (type=`agent_draft_ready`, `ref_id=ad.id`, `action_url=/app/agent-niva?tab=rss`)
3. User approves from RSS Feeds → Pending approvals panel
4. Dismissing draft deletes the draft + ad + linked notification (via `ref_id`)

**Notification ref_id cleanup:**
- `Notification.ref_id` stores the `ad_id` for draft-ready notifications
- Deleting ad (My Ads) or dismissing draft (RSS Feeds) also deletes notifications where `ref_id = ad.id`
- Both directions stay in sync

**RSS subscription API:**
- `GET/POST /agent/rss/subscriptions` — list/create
- `PATCH /agent/rss/subscriptions/{id}` — update (recomputes `generate_hour/minute` when post time or lead changes)
- `DELETE /agent/rss/subscriptions/{id}` — delete
- `GET /agent/rss/drafts` — pending manual approval drafts
- `POST /agent/rss/drafts/{id}/approve` — approve + post
- `DELETE /agent/rss/drafts/{id}` — dismiss (also deletes ad + notification)

**`_compute_generate_time(post_hour, post_minute, lead_minutes) → (hour, minute)`** helper in `agent_rss.py` — wraps midnight correctly (e.g. post=00:15, lead=30 → generate=23:45).

---

### Agent Niva — Brand Campaign Streak

**DB tables:** `website_streaks`, `streak_ads`

**Streak statuses:** `generating → ideas_ready → active → completed / failed / cancelled`
**Ad statuses:** `idea → scheduled → generating → generated → posted / failed / cancelled`

**Generation flow:**
- `generate_due_streak_ads` (hourly at :10) — finds `scheduled` streak ads whose local `scheduled_date/time - 24h` window has arrived
- Dispatches `generate_ad` to `generation` queue with header `streak_ad_id`
- `_on_generate_ad_success` signal flips `streak_ad.status = "generated"`
- Image generation enabled for streak ads (same as regular ads)

**Posting flow:**
- `post_due_streak_ads` (every 5 min) — finds `generated` streak ads where `scheduled_date/time <= now` (local timezone)
- Creates `PostJob` row, dispatches `post_ad_now` to `posting` queue
- **Credits**: checked via `SELECT SUM(delta) FROM credit_ledger WHERE company_id = ?` — NOT `company.credits` (that field does not exist)

---

### Agent Niva — Recurring Events

- `check_agent_events` runs daily 5AM UTC
- Notifications use `action_url=/app/agent-niva?tab=events`
- Posting goes through `ScheduledPost` rows → `fire_due_scheduled_posts` handles posting

---

### Notification System

**Bell panel (`app-shell.tsx`):**
- Polls `GET /agent/notifications` every 60s using `getAuthToken()` (reads `sessionStorage.nivaad_tokens.access_token`)
- Per-notification Clear button (X) + "Clear all" header button
- Clicking notification row navigates via TanStack Router: splits `action_url` on `?`, passes path + search params separately
- Mobile and desktop panels both use `<button>` elements (not `onClick` on `div`) for reliable touch handling

**Notification `action_url` routing:**
| Type | action_url |
|---|---|
| RSS draft ready | `/app/agent-niva?tab=rss` |
| Recurring event draft | `/app/agent-niva?tab=events` |
| Recurring event scheduled | `/app/calendar` |
| Auto-post warning | `/app/calendar` |

**Dismiss-all endpoint:** `POST /agent/notifications/dismiss-all`

---

### Ad Deletion — Full FK Cleanup

`DELETE /ads/{id}` cleans up in order:
1. `GenerationJob` (hard delete)
2. `PostJob` (hard delete)
3. `ScheduledPost` (hard delete)
4. `RssFeedDraft` (hard delete)
5. `Notification` where `ref_id = ad.id` (hard delete)
6. `AgentRecommendation.created_ad_id` → NULL
7. `StreakAd.ad_id` → NULL
8. `Ad` (hard delete)

Same cleanup applies in `DELETE /agent/rss/drafts/{id}` (dismiss draft also deletes the ad).

---

### Left Sidebar Nav — Glass Effect

`GlassNavItem` component in `app-shell.tsx`:
- Single `<span class="gni-overlay">` per item (not 4 spans) — GPU efficient
- Cursor position written as CSS custom props (`--gnx`, `--gny`) directly on DOM node via `ref.style.setProperty` — zero React re-renders on mousemove
- No `backdrop-filter` — removed (was heaviest GPU cost)
- Single `drop-shadow` filter on icons
- `box-shadow` on the Link element for neon ring (not a child span)
- Injected stylesheet uses `html.dark` / `html.light` selectors for theme-aware colours
- Dark mode base: `oklch(0.88 0.03 280)`, opacity `0.85` at rest

---

### Platform Posting — Known Fixes

**Instagram image posting (`app/services/meta.py`):**
- Must poll container status before publishing — `GET /{creation_id}?fields=status_code` every 3s up to 45s until `status_code == "FINISHED"`
- Error subcode `2207027` excluded from `permanent_failures` in `tasks.py`

**TikTok photo posting (`app/services/tiktok.py`):**
- `photo_images` must be a plain list of URL strings — NOT `[{"url": "..."}]`

**`PlatformPreviewCard` post button:**
- `handlePost` must `await onPost()` — not fire-and-forget

**`fire_due_scheduled_posts`:**
- Sets `ScheduledPost.status = "queued"` before dispatching — prevents double-dispatch on next 5-min run
- `post_ad_now` resolves both `"pending"` and `"queued"` ScheduledPost rows on completion

---

### Auth & User Management

- **Email verification required** — new users `status=pending`, activated via signed JWT link via SES
- **Resend verification** — 60s cooldown via Redis, max 5/hour
- **Token refresh mutex** — single `_refreshPromise` in `api.ts` prevents race on simultaneous 401s
- **Mascot reset on login** — `localStorage.removeItem("robotAwake")` on logout

---

### Billing & Credits

- **Plans**: Free (3 cr/mo), Starter ($17/mo, 150 cr/mo), Pro ($29/mo, 290 cr/mo)
- **Credit value**: $0.10. Top-ups: min 50 ($5), max 300 ($30), never expire
- **Credits stored in `CreditLedger` table** — Company model has NO `.credits` field — always query the ledger
- **Monthly reset**: plan credits expire; top-ups persist
- **Stripe webhook events**: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`

---

### App Features & Routes

**Create**
- `/app` — Create Ad
- `/app/campaigns` — Campaigns

**Library**
- `/app/my-ads` — My Ads
- `/app/products` — Products
- `/app/themes-gallery` — Themes Gallery
- `/app/calendar` — Calendar (streak ads shown in gold/amber)
- `/app/agent-niva` — Agent Niva (5 tabs, URL-driven via `?tab=`)

**Setup**
- `/app/brand-kit`, `/app/connections`, `/app/moderation`, `/app/settings`

**Insights**
- `/app/analytics`, `/app/admin`

**Auth & Dev**
- `/signup`, `/verify-email`, `/pricing`, `/developer-login`
- Developer panel tabs: Launch, Billing, API Endpoints, Users, Retention, Web Scraper, Theme AI, Aspect Ratios, Railway, Legal, RSS Feeds, Assistant
