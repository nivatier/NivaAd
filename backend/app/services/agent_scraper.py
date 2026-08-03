"""Scrapes a company website for Agent Niva's Quick Start flow.

Bot detection evasion
---------------------
Many sites run Incapsula, Cloudflare, or DataDome WAFs that fingerprint
headless browsers.  The main signals they check:

1. User-Agent string  — "HeadlessChrome", "Playwright", or any custom
   bot string is an instant block.  We use a real, current Chrome UA.

2. navigator.webdriver flag — Playwright sets this to `true` by default;
   we override it to `undefined` via an init script.

3. Headless browser tells — `navigator.plugins`, `navigator.languages`,
   `window.chrome`, and `navigator.permissions` all have different values
   in headless vs real Chrome.  We patch all of them.

4. Viewport & device pixel ratio — headless default is unusual;
   we set a real desktop size.

5. `wait_until` strategy — "networkidle" waits for all XHR to settle,
   which is more reliable on JS-heavy sites than "domcontentloaded".
   We keep networkidle but add a small human-like delay after load.

6. Random delays between page loads — pure sequential instant-loads look
   like a bot.  A small random pause (0.5–2s) between pages helps.

This handles Incapsula and most Cloudflare setups.  Sites running
advanced fingerprinting (e.g. PerimeterX/HUMAN) may still block — in
that case the scrape silently skips the blocked page and continues with
whatever was reachable.
"""
import logging
import random
import re
import time
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

logger = logging.getLogger("nivaad.agent_scraper")

# Fallback defaults — used when DB is unavailable or no config saved
_DEFAULT_MAX_PAGES       = 12
_DEFAULT_MAX_DEPTH       = 2
_DEFAULT_PAGE_TIMEOUT_MS = 20000

BLACKLIST_EXTENSIONS = (
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".zip",
    ".exe", ".svg", ".webp", ".mp4", ".mp3", ".woff", ".woff2",
)

# Real Chrome UA — rotate occasionally if sites start blocking this one
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

# JavaScript injected before every page load to mask headless tells
_STEALTH_SCRIPT = """
// 1. Remove the webdriver flag Playwright sets
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// 2. Fake a plugin list (headless Chrome has zero plugins)
Object.defineProperty(navigator, 'plugins', {
  get: () => [1, 2, 3, 4, 5],
});

// 3. Fake language list
Object.defineProperty(navigator, 'languages', {
  get: () => ['en-US', 'en'],
});

// 4. Add window.chrome so sites that check for it think we're real Chrome
window.chrome = { runtime: {} };

// 5. Spoof Notification permission to 'default' instead of headless 'denied'
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) =>
  parameters.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission })
    : originalQuery(parameters);
"""

# Bot-block signatures — if a page's text contains these we treat it as blocked
_BLOCK_SIGNATURES = [
    "incapsula incident",
    "request unsuccessful",
    "access denied",
    "403 forbidden",
    "enable javascript and cookies",
    "checking your browser",
    "ddos protection",
    "ray id",        # Cloudflare
    "cf-mitigated",  # Cloudflare
    "perimeterx",
    "px-captcha",
]


def get_scraper_settings_sync(db) -> dict:
    """Read scraper config from ModelConfig (sync — for Celery tasks).
    Falls back to defaults if no config has been saved yet."""
    try:
        from app.models import get_config_row_sync
        row = get_config_row_sync(db, "platform")
        cfg = (row.config or {}).get("scraper", {})
        return {
            "max_pages":       int(cfg.get("max_pages",       _DEFAULT_MAX_PAGES)),
            "max_depth":       int(cfg.get("max_depth",       _DEFAULT_MAX_DEPTH)),
            "page_timeout_ms": int(cfg.get("page_timeout_ms", _DEFAULT_PAGE_TIMEOUT_MS)),
        }
    except Exception:  # noqa: BLE001
        return {
            "max_pages":       _DEFAULT_MAX_PAGES,
            "max_depth":       _DEFAULT_MAX_DEPTH,
            "page_timeout_ms": _DEFAULT_PAGE_TIMEOUT_MS,
        }


def _is_blocked(text: str) -> bool:
    """Return True if the page text looks like a bot-block page."""
    lower = text.lower()
    return any(sig in lower for sig in _BLOCK_SIGNATURES)


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _extract_links(base_url: str, html: str, allowed_domain: str) -> set[str]:
    soup = BeautifulSoup(html, "html.parser")
    links = set()
    for tag in soup.find_all("a", href=True):
        href = tag["href"].strip()
        if href.startswith(("mailto:", "javascript:", "tel:")):
            continue
        url = urljoin(base_url, href)
        url = url.split("#")[0]
        if not url or urlparse(url).netloc != allowed_domain:
            continue
        if url.lower().split("?")[0].endswith(BLACKLIST_EXTENSIONS):
            continue
        links.add(url)
    return links


def scrape_company_website(url: str, db=None) -> str:
    """Crawls `url` (same-domain links only) rendering JavaScript via
    headless Chromium with bot-detection evasion and returns the combined
    visible text of every reachable page.

    Blocked pages (Incapsula, Cloudflare, etc.) are silently skipped —
    the crawl continues with whatever pages were accessible.

    Raises ValueError only if NO pages at all could be read (total block
    or invalid URL) — callers mark the job as failed in that case.
    """
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    allowed_domain = urlparse(url).netloc

    cfg = get_scraper_settings_sync(db) if db is not None else {
        "max_pages":       _DEFAULT_MAX_PAGES,
        "max_depth":       _DEFAULT_MAX_DEPTH,
        "page_timeout_ms": _DEFAULT_PAGE_TIMEOUT_MS,
    }
    max_pages       = cfg["max_pages"]
    max_depth       = cfg["max_depth"]
    page_timeout_ms = cfg["page_timeout_ms"]

    logger.info(
        "[agent_scraper] starting crawl: url=%s max_pages=%d max_depth=%d timeout=%dms",
        url, max_pages, max_depth, page_timeout_ms,
    )

    visited: set[str] = set()
    pages: dict[str, str] = {}
    blocked_count = 0

    def crawl(page, target_url: str, depth: int):
        nonlocal blocked_count
        if len(visited) >= max_pages or target_url in visited or depth > max_depth:
            return
        visited.add(target_url)

        # Small random human-like delay between page loads (skip on first page)
        if len(visited) > 1:
            time.sleep(random.uniform(0.5, 2.0))

        try:
            page.goto(target_url, wait_until="networkidle", timeout=page_timeout_ms)
            html = page.content()
        except Exception as exc:  # noqa: BLE001
            logger.info("[agent_scraper] %s failed to load, skipping: %s", target_url, exc)
            return

        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript", "svg", "template"]):
            tag.decompose()
        text = _clean_text(soup.get_text())

        if _is_blocked(text):
            blocked_count += 1
            logger.warning(
                "[agent_scraper] %s returned a bot-block page (Incapsula/Cloudflare/WAF) — skipping",
                target_url,
            )
            return

        if text:
            pages[target_url] = text

        links = _extract_links(target_url, html, allowed_domain)
        for link in links:
            if len(visited) >= max_pages:
                break
            crawl(page, link, depth + 1)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",  # key Incapsula tell
                "--disable-dev-shm-usage",
                "--disable-web-security",
                "--disable-features=IsolateOrigins,site-per-process",
            ],
        )
        try:
            context = browser.new_context(
                user_agent=_USER_AGENT,
                viewport={"width": 1366, "height": 768},
                device_scale_factor=1,
                locale="en-US",
                timezone_id="America/New_York",
                # Pretend to be a real desktop browser, not a headless tool
                extra_http_headers={
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Upgrade-Insecure-Requests": "1",
                    "Sec-Fetch-Dest": "document",
                    "Sec-Fetch-Mode": "navigate",
                    "Sec-Fetch-Site": "none",
                    "Sec-Fetch-User": "?1",
                },
            )
            # Inject stealth script before any page code runs
            context.add_init_script(_STEALTH_SCRIPT)
            page = context.new_page()
            crawl(page, url, 0)
        finally:
            browser.close()

    if not pages:
        if blocked_count > 0:
            raise ValueError(
                f"All pages on {url} were blocked by the site's bot protection (Incapsula/WAF). "
                f"The site actively prevents automated access. "
                f"Try a different URL from the same company, or enter the content manually."
            )
        raise ValueError(
            f"Couldn't read any content from {url}. Possible reasons: "
            f"(1) the URL is incorrect or the site is down, "
            f"(2) the site requires login to view content, "
            f"(3) a network/firewall rule is blocking outbound access to this domain. "
            f"Try the www subdomain (www.{urlparse(url).netloc}) or a specific page URL like /about or /products."
        )

    if blocked_count > 0:
        logger.warning(
            "[agent_scraper] %d page(s) were blocked by WAF on %s — scraped %d reachable page(s)",
            blocked_count, allowed_domain, len(pages),
        )

    combined = " ".join(pages.values())
    combined = _clean_text(combined)
    logger.info(
        "[agent_scraper] crawled %d page(s) from %s (%d blocked), %d chars total",
        len(pages), allowed_domain, blocked_count, len(combined),
    )
    return combined
