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

> **Note:** A docker-compose.yml update has been prepared to add a multi-worker profile (`--profile multi`, 4 workers, no hot-reload) for simulating Railway's concurrency locally. This has not been applied yet — upgrade the docker-compose.yml when ready.

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
# http://localhost:3000 or :5173
# VITE_API_BASE_URL=http://localhost:8000
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
STRIPE_WEBHOOK_SECRET=whsec_...   # from stripe-cli logs, different from production
```

### Common commands
```bash
docker compose up --build -d
docker compose exec api alembic upgrade head
docker compose logs -f api
docker compose logs -f worker
docker compose exec postgres psql -U nivaad -d nivaad
```

---

### Key Architecture Rules

- **`ModelConfig` table** — always use `get_config_row(db, "topic")`, never `db.get(ModelConfig, 1)`. The function uses `INSERT ... ON CONFLICT (topic) DO NOTHING` + re-fetch to prevent race conditions across multiple Railway workers. If you add a new topic key, no migration needed — the row is created on first access.
- **S3 URLs**: production R2 bucket NOT in path, local MinIO bucket IN path — `upload_bytes()` in `storage.py` handles both
- **Celery `worker` and `beat`** are separate Railway services, same Dockerfile, different start commands
- **Frontend uses TanStack Start with SSR** — never access `document`, `window` or `localStorage` without a `useState(false)` + `useEffect` guard (not `typeof document === "undefined"` — causes hydration mismatches in React 19)
- **localStorage in SSR**: wrap reads in `useState` + `useEffect`. Never call `localStorage` at module level or in render functions.
- **Page wrapper** uses `overflowX: "clip"` not `overflow-x-hidden`
- **All modals** use Radix Dialog (`@radix-ui/react-dialog`) — SSR-safe, no raw `createPortal`
- **Glass UI pattern**: `background: oklch(1 0 0 / 0.05)`, `backdropFilter: blur(20px) saturate(1.5)`, `border: 1px solid oklch(1 0 0 / 0.12)`, inset top highlight `inset 0 1px 0 oklch(1 0 0 / 0.16)`
- **Brand gold**: `oklch(0.85 0.18 52)` / hex `#E8B84B`
- **SSR guard** for legal modals and any client-only state: always wrap in `<>...</>` fragment when modal is a sibling to main return div
- **Prefilling Create Ad from external flows** (Agent Niva, RSS ideas): store a `nivaad_prefill_product` object in `sessionStorage` before navigating to `/app`. Fields: `name`, `description`, `audience`, `goal`, `tone`, `voice`, `copy_directions`, `source_url`, `image_scene`. The `image_scene` field pre-fills the Image description textarea — must be stored via `pendingImageSceneRef` (declared before the `refMode` clearing `useEffect`) and applied with `setTimeout(0)`, otherwise it gets wiped on mount.
- **LLM responses that return JSON arrays**: never use `text_gen.generate_text()` — it calls `_extract_json()` which only finds `{...}` objects, not `[...]` arrays. Use `httpx.AsyncClient` directly and extract the array with `raw[raw.find("["):raw.rfind("]")+1]`.
- **LLM responses that return plain text** (e.g. rewrite endpoints): never use `text_gen.generate_text()` — it crashes on non-JSON. Use `httpx.AsyncClient` directly and read `.get("content", "")` from the choices.

---

### Alembic Migration Chain (latest)
```
4394d363aa27  initial schema
...
v2w3x4y5z6a7  add developer_status to flagged_content
w3x4y5z6a7b8  add rss feed tables (rss_feeds, rss_feed_subscriptions, rss_feed_seen_items, rss_feed_drafts)
x4y5z6a7b8c9  add rss feed health check columns (last_checked_at, last_status, last_error, last_article_count)
y5z6a7b8c9d0  add image_prompt to agent_recommendations
```
Always run `alembic upgrade head` after deploying new migrations.

---

### Agent Niva — RSS Feed Feature

New section added to Agent Niva with full auto-posting from RSS feeds.

**Backend routes:**
- `GET/POST/PATCH/DELETE /developer/rss/feeds` — developer feed catalogue management
- `GET /developer/rss/settings` + `PUT /developer/rss/settings` — health check interval (default 7 days)
- `POST /developer/rss/feeds/{id}/check` — manual health re-check
- `GET /agent/rss/feeds/catalogue` — grouped feed catalogue for users
- `GET/POST /agent/rss/subscriptions` + `PATCH/DELETE /agent/rss/subscriptions/{id}` — user subscriptions
- `GET /agent/rss/drafts` + `POST /agent/rss/drafts/{id}/approve` + `DELETE /agent/rss/drafts/{id}` — manual approval drafts
- `POST /agent/rss/get-ideas` — fetch live feed, AI picks best articles + generates image prompts

**Celery beat tasks:**
- `process_rss_feeds` — runs hourly, processes due subscriptions
- `check_rss_feed_health` — runs daily at 06:00 UTC, checks feeds older than `health_check_interval_days`

**RSS feed bulk management (developer panel):**
- Export all feeds as JSON — use on local, import on production
- Import JSON file — sequential insert, 409 conflicts silently skipped

**Tone/Voice system** (RSS + Agent Niva):
- Options: `we` / `i` / `you` / `they` / `lets` — controls writing perspective
- Maps to Create Ad `tone` chip + `voice` field + `copy_directions` instruction
- Stored in `rss_feed_subscriptions.tone_style` — validated against `^(we|i|you|they|lets)$`

**RSS Ideas panel:**
- Ideas saved in `localStorage` key `nivaspark_rss_ideas` with 24h TTL
- Auto-purged on load if older than 24h
- Per-idea settings (voice, include link, image scene) editable inline and persisted immediately

---

### Agent Niva — Website Spark Image Prompts

The quick-start recommendations task (`generate_quick_start_recommendations`) now:
- Uses system + user message split (not single user message)
- Truncates site text to 6,000 chars before sending to LLM
- Uses `max_tokens: 4000` for output
- Returns `image_prompt` per idea — stored in `agent_recommendations.image_prompt`
- `_rec_out()` serialises `image_prompt` to the API response
- RecCard shows editable 🖼 Image prompt textarea with **✦ Generate · 0.25 cr** button (`POST /agent/recommendations/{id}/image-prompt`)

---

### Platform Posting — Known Fixes

**Instagram image posting (`app/services/meta.py`):**
- `_post_image_instagram` must poll container status before publishing
- Poll `GET /{creation_id}?fields=status_code` every 3s up to 45s until `status_code == "FINISHED"`
- Without polling → error `2207027` "media not ready for publishing"
- Error subcode `2207027` excluded from `permanent_failures` in `tasks.py`

**TikTok photo posting (`app/services/tiktok.py`):**
- `photo_images` in `PULL_FROM_URL` mode must be a **plain list of URL strings**
- NOT a list of `{"url": "..."}` objects — causes `invalid_params 400`
- Correct: `"photo_images": ["https://...", "https://..."]`

**`PlatformPreviewCard` post button (`src/components/create-ad-parts.tsx`):**
- `handlePost` must `await onPost()` — not fire-and-forget
- `onPost` prop typed as `() => Promise<void> | void`
- Without await: button spins for 0ms, `PostingProgressModal` never opens visibly

---

### Auth & User Management

- **Email verification required** — new users created as `status=pending`, activated via signed JWT link sent by SES. Login blocked until verified.
- **Resend verification** — 60s cooldown enforced via Redis (`verify:cooldown:{email}`), max 5/hour (`verify:count:{email}`). No password required for resend.
- **Token refresh mutex** — single `_refreshPromise` in `api.ts` prevents simultaneous 401s from each triggering independent refresh calls (race condition fix).
- **Mascot reset on login** — `localStorage.removeItem("robotAwake")` called on logout and on user identity change so Nova always wakes fresh on next login.

---

### Billing & Credits

- **Plans**: Free (3 cr/mo), Starter ($17/mo, 150 cr/mo), Pro ($29/mo, 290 cr/mo)
- **Terms**: 1mo / 3mo (−5%) / 6mo (−10%) / 12mo (−12%)
- **Credit value**: $0.10 per credit. Top-ups: min 50 credits ($5), max 300 ($30), never expire.
- **Monthly reset**: use-it-or-lose-it. Plan credits expire each month; top-ups persist.
- **Annual/multi-month plans**: Stripe fires `invoice.paid` once per term — monthly credit resets handled by daily Celery beat task at 00:30 UTC.
- **Upgrade flow**: Free → paid = Stripe Checkout. Existing paid → upgrade = Stripe Customer Portal (shows proration).
- **Downgrade rules (mid-cycle)**: any shorter term or lower tier is blocked. Allowed after period ends or cancel scheduled.
- **Credit reset on tier upgrade**: `customer.subscription.updated` webhook expires old plan credits and grants new monthly allowance immediately.
- **Stripe webhook events**: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
- **Price IDs**: stored in Developer panel DB config (no redeploy needed). `.env` `STRIPE_PRICE_IDS` is fallback only.
- **`current_period_end`**: saved from Stripe subscription object in `checkout.session.completed` — not populated by `invoice.paid` alone.

---

### App Features & Routes

**Create**
- `/app` — Create Ad: select product → brief → AI generates copy + image. Supports `nivaad_prefill_product` sessionStorage for pre-filling from Agent Niva/RSS flows.
- `/app/campaigns` — Campaigns: one brief → teaser + launch + follow-up ads across all platforms

**Library**
- `/app/my-ads` — My Ads: browse and manage all generated ads
- `/app/products` — Products: save product details
- `/app/themes-gallery` — Themes Gallery: visual themes for every platform ratio
- `/app/calendar` — Calendar: scheduled post view
- `/app/agent-niva` — Agent Niva: 4 tabs — Website Spark, Quick Spark, Recurring Events, RSS Feeds

**Setup**
- `/app/brand-kit` — Brand Kit: logo, colours, tone of voice
- `/app/connections` — Connections: Instagram, LinkedIn, TikTok, Facebook, X, Threads
- `/app/moderation` — Moderation: content approval workflow
- `/app/settings` — Plan & Billing

**Insights**
- `/app/analytics` — Analytics: post performance
- `/app/admin` — Admin: platform administration

**Auth & Dev**
- `/signup`, `/verify-email`, `/pricing`, `/developer-login`
- Developer panel tabs: Launch, Billing, API Endpoints, Users, Retention, Web Scraper, Theme AI, Aspect Ratios, Railway, Legal, **RSS Feeds** (feed catalogue with bulk import/export JSON, health status dots, re-check button, category + status filters, bulk select/delete/recheck)