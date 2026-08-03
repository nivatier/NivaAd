"""add pgvector + scraped_site_chunks table

Revision ID: q5r6s7t8u9v0
Revises: p4q5r6s7t8u9
Create Date: 2026-08-03

What this does
--------------
1. Enables the pgvector extension (idempotent — safe if already present).
2. Creates `scraped_site_chunks` — one row per text chunk per saved site.
   Each row holds the raw chunk text + a 1536-dim embedding vector
   (text-embedding-3-small output size).
3. Creates an HNSW index on the vector column for fast cosine-similarity
   search (much faster than the default IVFFlat for our data sizes).

Why 1536 dims?
   text-embedding-3-small outputs 1536-dim vectors and is the cheapest
   OpenAI-compatible embedding model available on OpenRouter.  If you
   ever switch to a different embedding model, drop and recreate the
   chunks table (all chunks are re-embeddable from the parent
   scraped_sites.content at any time).

HNSW vs IVFFlat?
   IVFFlat needs a training step (needs data before it can build the
   index) which complicates migrations.  HNSW builds incrementally and
   is faster at query time for our scale (<1M vectors).  m=16, ef=64
   are sensible defaults for a retrieval use-case.
"""
from alembic import op

# revision identifiers
revision = "q5r6s7t8u9v0"
down_revision = "p4q5r6s7t8u9"
branch_labels = None
depends_on = None

EMBEDDING_DIM = 1536  # text-embedding-3-small


def upgrade() -> None:
    # 1. Enable pgvector — idempotent, won't error if already installed
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # 2. Create the chunks table
    op.execute(f"""
        CREATE TABLE IF NOT EXISTS scraped_site_chunks (
            id          BIGSERIAL PRIMARY KEY,
            site_id     UUID        NOT NULL REFERENCES scraped_sites(id) ON DELETE CASCADE,
            company_id  UUID        NOT NULL REFERENCES companies(id)     ON DELETE CASCADE,
            chunk_index INTEGER     NOT NULL,          -- 0-based order within the site
            chunk_text  TEXT        NOT NULL,          -- raw text for this chunk
            embedding   vector({EMBEDDING_DIM}),       -- NULL until embedded
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    # 3. Ordinary indexes
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_scraped_site_chunks_site_id
            ON scraped_site_chunks (site_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_scraped_site_chunks_company_id
            ON scraped_site_chunks (company_id)
    """)

    # 4. HNSW vector index for cosine similarity (<=>)
    #    Created AFTER the table so it builds on whatever data is already
    #    there (none at migration time, but correct for future re-runs).
    op.execute(f"""
        CREATE INDEX IF NOT EXISTS ix_scraped_site_chunks_embedding
            ON scraped_site_chunks
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS scraped_site_chunks")
    # We intentionally do NOT drop the vector extension on downgrade —
    # other tables/indexes might use it, and Railway managed Postgres
    # may not allow dropping extensions anyway.
