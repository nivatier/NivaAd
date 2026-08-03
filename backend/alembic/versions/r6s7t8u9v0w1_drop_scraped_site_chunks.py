"""drop scraped_site_chunks table (pgvector RAG not needed)

Revision ID: r6s7t8u9v0w1
Revises: q5r6s7t8u9v0
Create Date: 2026-08-03

scraped_site_chunks was created for a pgvector RAG pipeline that turned
out to be unnecessary — with MAX_PAGES=12 the worst-case scrape is
~60,000 chars (~15,000 tokens), well within any modern LLM context window.
The full site text is sent directly from scraped_sites.content to the
LLM prompt with no chunking or vector search needed.

The pgvector extension itself is left in place (harmless, and the
pgvector/pgvector:pg16 image always has it anyway).
"""
from alembic import op

revision = "r6s7t8u9v0w1"
down_revision = "q5r6s7t8u9v0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS scraped_site_chunks")


def downgrade() -> None:
    # Recreate the table if rolling back — matches the original migration
    op.execute("""
        CREATE TABLE IF NOT EXISTS scraped_site_chunks (
            id          BIGSERIAL PRIMARY KEY,
            site_id     UUID        NOT NULL REFERENCES scraped_sites(id) ON DELETE CASCADE,
            company_id  UUID        NOT NULL REFERENCES companies(id)     ON DELETE CASCADE,
            chunk_index INTEGER     NOT NULL,
            chunk_text  TEXT        NOT NULL,
            embedding   vector(1536),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_scraped_site_chunks_site_id ON scraped_site_chunks (site_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_scraped_site_chunks_company_id ON scraped_site_chunks (company_id)")
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_scraped_site_chunks_embedding
            ON scraped_site_chunks
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64)
    """)
