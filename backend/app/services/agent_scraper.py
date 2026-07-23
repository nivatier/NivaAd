"""Scrapes a company website for Agent Niva's Quick Start flow (see
tasks.generate_quick_start_recommendations, which feeds the result into
an AI prompt to recommend ad ideas).

Adapted from the customer's own scraper (a Playwright crawl + BeautifulSoup
text extraction + LangChain/FAISS embedding pipeline for RAG). Only the
CRAWL is kept here — the embedding/vector-index half was for retrieval-
augmented Q&A, which isn't what Quick Start needs; it just wants the
site's raw text handed straight to a text-generation prompt once, so
FAISS/LangChain/OpenAIEmbeddings are dropped entirely (no
langchain/faiss/openai dependency added to this project for it).

Runs Playwright's SYNC API (not async, like the original script) since
this is called from inside a synchronous Celery task, not an event loop.

Crawl limits are intentionally much smaller than the original script's
defaults (MAX_PAGES=200, MAX_DEPTH=10 — built for thoroughly indexing a
whole site for RAG). Quick Start just needs enough of the site to
recommend a handful of ad ideas from, and a customer waiting on a
"Quick Start" button expects seconds, not a multi-minute crawl — see
MAX_PAGES/MAX_DEPTH below, easy to raise if 200/10-style thoroughness
ever actually matters here.
"""
import logging
import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

logger = logging.getLogger("nivaad.agent_scraper")

MAX_DEPTH = 2
MAX_PAGES = 12
MAX_CHARS = 12000  # combined across all crawled pages — keeps the AI recommendation prompt a sane size
BLACKLIST_EXTENSIONS = (".pdf", ".jpg", ".jpeg", ".png", ".gif", ".zip", ".exe", ".svg", ".webp", ".mp4", ".mp3")
USER_AGENT = "Mozilla/5.0 (compatible; NivaSparkAgent/1.0)"
PAGE_TIMEOUT_MS = 20000


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
        url = url.split("#")[0]  # strip the fragment BEFORE the domain/extension checks below — a same-page anchor like "#section" and a real link with both a query string and an anchor ("/blog?x=1#top") both need this, just for different reasons: the former becomes an empty/duplicate URL naturally caught by the visited-set, the latter would otherwise get wrongly discarded entirely for merely containing a "#"
        if not url or urlparse(url).netloc != allowed_domain:
            continue
        if url.lower().split("?")[0].endswith(BLACKLIST_EXTENSIONS):
            continue
        links.add(url)
    return links


def scrape_company_website(url: str) -> str:
    """Crawls `url` (same-domain links only, up to MAX_PAGES pages /
    MAX_DEPTH levels deep) rendering JavaScript via headless Chromium,
    and returns the combined visible text of every page it reached,
    capped at MAX_CHARS. Raises on total failure (e.g. the homepage
    itself won't load) — callers (the Celery task) are expected to
    catch that and surface it as a failed AgentScrapeJob."""
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    allowed_domain = urlparse(url).netloc

    visited: set[str] = set()
    pages: dict[str, str] = {}

    def crawl(page, target_url: str, depth: int):
        if len(visited) >= MAX_PAGES or target_url in visited or depth > MAX_DEPTH:
            return
        visited.add(target_url)
        try:
            page.goto(target_url, wait_until="networkidle", timeout=PAGE_TIMEOUT_MS)
            html = page.content()
        except Exception as exc:  # noqa: BLE001
            logger.info("[agent_scraper] %s failed to load, skipping: %s", target_url, exc)
            return

        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript", "svg", "template"]):
            tag.decompose()
        text = _clean_text(soup.get_text())
        if text:
            pages[target_url] = text

        links = _extract_links(target_url, html, allowed_domain)
        for link in links:
            if len(visited) >= MAX_PAGES:
                break
            crawl(page, link, depth + 1)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(user_agent=USER_AGENT)
            page = context.new_page()
            crawl(page, url, 0)
        finally:
            browser.close()

    if not pages:
        raise ValueError(f"Couldn't read any content from {url} — check the URL is correct and publicly reachable.")

    combined = " ".join(pages.values())
    combined = _clean_text(combined)
    logger.info("[agent_scraper] crawled %d page(s) from %s, %d chars total", len(pages), allowed_domain, len(combined))
    return combined[:MAX_CHARS]
