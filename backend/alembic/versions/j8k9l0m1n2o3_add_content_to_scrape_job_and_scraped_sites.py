"""add content to agent_scrape_jobs and create scraped_sites

Revision ID: j8k9l0m1n2o3
Revises: i7j8k9l0m1n2
Create Date: 2026-07-23
"""
from alembic import op
import sqlalchemy as sa

revision = 'j8k9l0m1n2o3'
down_revision = 'i7j8k9l0m1n2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('agent_scrape_jobs', sa.Column('content', sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column('agent_scrape_jobs', 'content')
