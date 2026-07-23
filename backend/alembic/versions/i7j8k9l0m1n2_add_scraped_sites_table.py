"""add scraped_sites table

Revision ID: i7j8k9l0m1n2
Revises: h6i7j8k9l0m1
Create Date: 2026-07-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'i7j8k9l0m1n2'
down_revision = 'h6i7j8k9l0m1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS scraped_sites (
            id UUID PRIMARY KEY,
            company_id UUID NOT NULL REFERENCES companies(id),
            url VARCHAR(500) NOT NULL,
            label VARCHAR(200) NOT NULL DEFAULT '',
            content TEXT NOT NULL,
            scraped_at TIMESTAMP NOT NULL
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_scraped_sites_company_id
        ON scraped_sites (company_id)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_scraped_sites_company_id")
    op.execute("DROP TABLE IF EXISTS scraped_sites")
