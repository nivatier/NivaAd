// Shared frontend tunables. The backend has a matching value in its own
// config (backend/app/config.py -> CAROUSEL_MAX_IMAGES, settable via
// .env) — the two can't literally share one file since they're separate
// runtimes (a Vite build vs a Python server), so if you change this
// limit, update BOTH places. The backend value is authoritative and
// re-validates server-side regardless of what the UI allows, so this
// one is really just for capping the picker UI sensibly.
export const CAROUSEL_MAX_IMAGES = 5;
export const CAROUSEL_MIN_IMAGES = 2;
export const MAX_VIDEO_SHOTS = 4; // matches backend/app/services/credits.py MAX_VIDEO_SHOTS
