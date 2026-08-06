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

Railway: 2 vCPU / 1 GB RAM per service. Hobby plan $5/month base.

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

- `ModelConfig` table split into per-topic rows — always use `get_config_row(db, "topic")`, never `db.get(ModelConfig, 1)`
- S3 URLs: production R2 bucket NOT in path, local MinIO bucket IN path — `upload_bytes()` in `storage.py` handles both
- Celery `worker` and `beat` are separate Railway services, same Dockerfile, different start commands
- Frontend uses TanStack Start with SSR — never access `document`, `window` or `localStorage` without a `useState(false)` + `useEffect` guard (not `typeof document === "undefined"` — that causes hydration mismatches in React 19)
- Page wrapper uses `overflowX: "clip"` not `overflow-x-hidden`
- All modals use Radix Dialog (`@radix-ui/react-dialog`) — SSR-safe, no raw `createPortal`
- Glass UI pattern used throughout: `background: oklch(1 0 0 / 0.05)`, `backdropFilter: blur(20px) saturate(1.5)`, `border: 1px solid oklch(1 0 0 / 0.12)`, inset top highlight `inset 0 1px 0 oklch(1 0 0 / 0.16)`
- Brand gold: `oklch(0.85 0.18 52)` / hex `#E8B84B`
- SSR guard for legal modals and any client-only state: always wrap in `<>...</>` fragment when modal is a sibling to main return div

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
- **Annual/multi-month plans**: Stripe fires `invoice.paid` once per term — monthly credit resets handled by daily Celery beat task at 00:30 UTC (checks anniversary day per subscription).
- **Upgrade flow**: Free → paid = Stripe Checkout. Existing paid → upgrade = Stripe Customer Portal (shows proration). Return URL has no `?billing=success` — portal fires on both confirm and cancel.
- **Downgrade rules (mid-cycle)**: any shorter term or lower tier is blocked. Allowed after period ends or cancel scheduled.
- **Credit reset on tier upgrade**: `customer.subscription.updated` webhook expires old plan credits and grants new monthly allowance immediately.
- **Stripe webhook events**: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
- **Price IDs**: stored in Developer panel DB config (no redeploy needed). `.env` `STRIPE_PRICE_IDS` is fallback only.
- **`current_period_end`**: saved from Stripe subscription object in `checkout.session.completed` — not populated by `invoice.paid` alone.

---

### App Features & Routes

**Create**
- `/app` — Create Ad: select product → brief → AI generates copy + image
- `/app/campaigns` — Campaigns: one brief → teaser + launch + follow-up ads across all platforms

**Library**
- `/app/my-ads` — My Ads: browse and manage all generated ads
- `/app/products` — Products: save product details (name, description, images, brand voice, audience) — foundation of all ad generation
- `/app/themes-gallery` — Themes Gallery: visual themes for every platform ratio
- `/app/calendar` — Calendar: scheduled post view
- `/app/agent-niva` — Agent Niva: autonomous ad engine — scrapes URLs, schedules by occasion, runs without user input

**Setup**
- `/app/brand-kit` — Brand Kit: logo, colours, tone of voice — applied to every ad automatically
- `/app/connections` — Connections: connect Instagram, LinkedIn, TikTok, Facebook, X, Threads. Callback path is `/connections/linkedin_personal/callback` — must match what is registered in each platform's developer app.
- `/app/moderation` — Moderation: content approval workflow
- `/app/settings` — Plan & Billing: current plan details, next charge, credits bar, upgrade/cancel/manage billing

**Insights**
- `/app/analytics` — Analytics: post performance
- `/app/admin` — Admin: platform administration

**Auth & Dev**
- `/signup` — Registration with email verification flow
- `/verify-email` — Handles verification link clicks, auto-redirects to app on success
- `/pricing` — Pricing page: plan cards, term toggle, upgrade/downgrade logic, current plan highlight
- `/developer-login` — Developer panel login
- Developer panel: manage legal content (Terms, Privacy, Acceptable Use, Cookies), model config, platform settings, launch control, Stripe price IDs
