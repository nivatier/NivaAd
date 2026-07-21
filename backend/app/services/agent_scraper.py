"""Scrapes a company website's text content for Agent Niva's Quick Start
flow (see tasks.generate_quick_start_recommendations, which feeds the
result into an AI prompt to recommend ad ideas).

*** REPLACE THIS WITH YOUR OWN SCRAPER ***
This module currently ships a minimal working default (httpx fetch +
stdlib HTML text extraction) so Quick Start is functional out of the
box — no external scraping library, no JS rendering, so it will miss
content that only appears after client-side JavaScript runs. If you
have a more capable scraper already built (e.g. one that renders
JS-embedded content), replace the body of `scrape_company_website`
below with a call into it — keep the same signature
(url: str) -> str, returning the extracted text — and every caller
(the Celery task, the API route) keeps working unchanged.
"""
import logging
import re
from html.parser import HTMLParser

import httpx

logger = logging.getLogger("nivaad.agent_scraper")

MAX_CHARS = 8000  # keeps the AI recommendation prompt a sane size — a full site dump doesn't improve results, it just costs more tokens
SKIP_TAGS = {"script", "style", "noscript", "svg", "template"}


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.chunks: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data):
        if self._skip_depth == 0 and data.strip():
            self.chunks.append(data.strip())


def scrape_company_website(url: str) -> str:
    """Fetches `url` and returns its visible text content, whitespace-
    collapsed and capped at MAX_CHARS. Raises on network/HTTP failure —
    callers (the Celery task) are expected to catch and surface that as
    a failed AgentScrapeJob rather than letting it crash the worker."""
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"

    resp = httpx.get(url, timeout=20, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (compatible; NivaAdAgent/1.0)"})
    resp.raise_for_status()

    parser = _TextExtractor()
    parser.feed(resp.text)
    text = " ".join(parser.chunks)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        raise ValueError("No readable text content found on that page — it may be entirely JavaScript-rendered, which this default scraper can't see. Replace agent_scraper.py's scrape_company_website with a JS-capable scraper if that's common for your customers' sites.")
    return text[:MAX_CHARS]
