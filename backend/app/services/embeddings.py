"""services/embeddings.py — text chunking + embedding via OpenRouter,
and pgvector similarity search for scraped site content.

Pipeline
--------
1.  scrape_company_website()  →  raw text  (agent_scraper.py)
2.  chunk_text()              →  list[str] chunks
3.  embed_chunks()            →  list[list[float]] vectors
4.  store_chunks()            →  rows in scraped_site_chunks
5.  search_chunks()           →  top-k chunks for a query string

The embedding model used is text-embedding-3-small via OpenRouter's
embeddings endpoint (same base URL and API key as chat completions —
OpenRouter proxies the OpenAI embeddings API transparently).

Embedding model: text-embedding-3-small
  - 1536 dimensions (matches EMBEDDING_DIM in the migration)
  - Cheap: ~$0.02 per million tokens
  - Fast: synchronous batch call, all chunks in one HTTP request

Chunking strategy: fixed-size with overlap
  - CHUNK_SIZE  = 600 tokens  ≈ 450 words  ≈ ~2400 chars
  - CHUNK_OVERLAP = 100 tokens ≈ 75 words  ≈ ~400 chars
  We use a simple character-based approximation (4 chars ≈ 1 token)
  rather than a full tokeniser to avoid adding tiktoken as a dependency.
  This is accurate enough for chunking — the goal is "roughly 600 tokens"
  not "exactly 600 tokens".

Usage (from Celery task — sync context)
----------------------------------------
from app.services.embeddings import embed_and_store_site, search_site

# After scraping — replaces the old direct content save:
embed_and_store_site(db, site_id, company_id, raw_text)

# When generating recommendations from a saved site:
relevant_text = search_site(db, site_id, query="product launch ideas", top_k=6)
"""
import logging
import textwrap
import uuid
from typing import Optional

import httpx
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import settings

logger = logging.getLogger("nivaad.embeddings")

# ── Chunking constants ────────────────────────────────────────────────
CHARS_PER_TOKEN = 4          # rough approximation — good enough for chunking
CHUNK_TOKENS    = 600        # target chunk size in tokens
CHUNK_OVERLAP_TOKENS = 100   # overlap between consecutive chunks in tokens
CHUNK_SIZE      = CHUNK_TOKENS * CHARS_PER_TOKEN          # 2400 chars
CHUNK_OVERLAP   = CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN  # 400 chars

# ── Embedding constants ───────────────────────────────────────────────
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM   = 1536
EMBEDDING_URL   = f"{settings.OPENROUTER_BASE_URL}/embeddings"
MAX_BATCH       = 100   # OpenRouter / OpenAI limit per embeddings request

# ── No-content removed, so we store unlimited text now ───────────────
# The old MAX_CHARS = 12000 cap in agent_scraper.py is REMOVED.
# The scraper still caps at MAX_PAGES/MAX_DEPTH for crawl time, but
# the text limit is gone — all crawled text is chunked and embedded.


# ─────────────────────────────────────────────────────────────────────
# 1. Chunking
# ─────────────────────────────────────────────────────────────────────

def chunk_text(text: str) -> list[str]:
    """Split `text` into overlapping fixed-size chunks.

    Returns an empty list for empty/whitespace-only input.
    Each chunk is stripped of leading/trailing whitespace.
    """
    text = text.strip()
    if not text:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = end - CHUNK_OVERLAP  # back up by overlap amount

    return chunks


# ─────────────────────────────────────────────────────────────────────
# 2. Embedding
# ─────────────────────────────────────────────────────────────────────

def embed_chunks(chunks: list[str]) -> list[list[float]]:
    """Embed a list of text chunks via OpenRouter's embeddings endpoint.

    Sends in batches of MAX_BATCH to respect API limits.
    Returns a list of float vectors in the same order as `chunks`.
    Raises RuntimeError if the API call fails.
    """
    if not chunks:
        return []

    all_vectors: list[list[float]] = []

    for i in range(0, len(chunks), MAX_BATCH):
        batch = chunks[i : i + MAX_BATCH]
        resp = httpx.post(
            EMBEDDING_URL,
            headers={
                "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": EMBEDDING_MODEL,
                "input": batch,
            },
            timeout=60,
        )
        if resp.status_code >= 400:
            raise RuntimeError(
                f"OpenRouter embeddings error {resp.status_code}: {resp.text[:300]}"
            )

        data = resp.json()
        # OpenAI-compatible response: {"data": [{"embedding": [...], "index": N}, ...]}
        items = sorted(data["data"], key=lambda x: x["index"])
        all_vectors.extend(item["embedding"] for item in items)

    logger.info(
        "[embeddings] embedded %d chunks → %d-dim vectors via %s",
        len(chunks), EMBEDDING_DIM, EMBEDDING_MODEL,
    )
    return all_vectors


# ─────────────────────────────────────────────────────────────────────
# 3. Store chunks (sync — called from Celery task)
# ─────────────────────────────────────────────────────────────────────

def store_chunks(
    db: Session,
    site_id: uuid.UUID,
    company_id: uuid.UUID,
    chunks: list[str],
    vectors: list[list[float]],
) -> None:
    """Delete any existing chunks for this site and insert the new ones.

    Called within the same Celery task session that saved the
    ScrapedSite row — all in one transaction.
    """
    # Delete stale chunks from a previous scrape of the same URL
    db.execute(
        text("DELETE FROM scraped_site_chunks WHERE site_id = :site_id"),
        {"site_id": str(site_id)},
    )

    # The vector literal is interpolated directly into the SQL string (not
    # as a bound parameter) because psycopg's parameter substitution and
    # the ::vector cast conflict when used together — the driver converts
    # :name params to $1/$2 positional style, which breaks :embedding::vector.
    # The vector value is a list of floats we built ourselves so this is safe.
    for idx, (chunk, vector) in enumerate(zip(chunks, vectors)):
        vector_literal = "[" + ",".join(str(v) for v in vector) + "]"
        db.execute(
            text(f"""
                INSERT INTO scraped_site_chunks
                    (site_id, company_id, chunk_index, chunk_text, embedding)
                VALUES
                    (:site_id, :company_id, :idx, :chunk_text, '{vector_literal}'::vector)
            """),
            {
                "site_id":    str(site_id),
                "company_id": str(company_id),
                "idx":        idx,
                "chunk_text": chunk,
            },
        )

    logger.info(
        "[embeddings] stored %d chunks for site_id=%s", len(chunks), site_id
    )

    logger.info(
        "[embeddings] stored %d chunks for site_id=%s", len(chunks), site_id
    )


# ─────────────────────────────────────────────────────────────────────
# 4. High-level helper — chunk + embed + store in one call
# ─────────────────────────────────────────────────────────────────────

def embed_and_store_site(
    db: Session,
    site_id: uuid.UUID,
    company_id: uuid.UUID,
    raw_text: str,
) -> int:
    """Full pipeline: chunk raw_text → embed → store in DB.

    Returns the number of chunks stored.
    Commits are left to the caller (Celery task commits after this).
    """
    chunks = chunk_text(raw_text)
    if not chunks:
        logger.warning("[embeddings] no chunks produced for site_id=%s", site_id)
        return 0

    vectors = embed_chunks(chunks)
    store_chunks(db, site_id, company_id, chunks, vectors)
    return len(chunks)


# ─────────────────────────────────────────────────────────────────────
# 5. Similarity search — retrieve top-k relevant chunks
# ─────────────────────────────────────────────────────────────────────

def search_site(
    db: Session,
    site_id: uuid.UUID,
    query: str,
    top_k: int = 6,
) -> str:
    """Embed `query` and return the top_k most relevant chunks from this
    site, joined as a single string ready to drop into an LLM prompt.

    Falls back to returning ALL chunk texts (in order) if no embeddings
    are stored yet — graceful degradation for sites saved before this
    feature was deployed.
    """
    # Embed the query
    query_vectors = embed_chunks([query])
    if not query_vectors:
        return _fallback_text(db, site_id)

    query_vector = query_vectors[0]
    vector_literal = "[" + ",".join(str(v) for v in query_vector) + "]"

    rows = db.execute(
        text("""
            SELECT chunk_text
            FROM   scraped_site_chunks
            WHERE  site_id = :site_id
              AND  embedding IS NOT NULL
            ORDER BY embedding <=> :query_vec::vector
            LIMIT  :top_k
        """),
        {
            "site_id":   str(site_id),
            "query_vec": vector_literal,
            "top_k":     top_k,
        },
    ).fetchall()

    if not rows:
        return _fallback_text(db, site_id)

    return "\n\n---\n\n".join(row[0] for row in rows)


def _fallback_text(db: Session, site_id: uuid.UUID) -> str:
    """Return all chunks in order when no embeddings are available."""
    rows = db.execute(
        text("""
            SELECT chunk_text
            FROM   scraped_site_chunks
            WHERE  site_id = :site_id
            ORDER BY chunk_index
        """),
        {"site_id": str(site_id)},
    ).fetchall()
    return "\n\n---\n\n".join(row[0] for row in rows) if rows else ""


# ─────────────────────────────────────────────────────────────────────
# 6. Async variant for the FastAPI router (re-embed on rename/resave)
# ─────────────────────────────────────────────────────────────────────

async def search_site_async(
    db,   # AsyncSession
    site_id: uuid.UUID,
    query: str,
    top_k: int = 6,
) -> str:
    """Async version of search_site for use in FastAPI route handlers.

    The embedding call is still synchronous HTTP (httpx) — for the
    sizes involved this is fine, but wrap in asyncio.to_thread if you
    ever see event-loop blocking warnings.
    """
    import asyncio
    return await asyncio.to_thread(
        _search_site_sync_with_async_db, site_id, query, top_k
    )


def _search_site_sync_with_async_db(
    site_id: uuid.UUID,
    query: str,
    top_k: int,
) -> str:
    """Helper — creates its own sync connection for the async-route case."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session as _Session
    from app.config import settings as _s

    engine = create_engine(
        _s.DATABASE_URL.replace("+asyncpg", "+psycopg"), pool_pre_ping=True
    )
    with _Session(engine) as db:
        return search_site(db, site_id, query, top_k)
