"""add agent niva tables (events, recommendations, scrape jobs) + ad tagging

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
Create Date: 2026-07-21 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'b0c1d2e3f4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'agent_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('day', sa.Integer(), nullable=False),
        sa.Column('lead_days', sa.Integer(), nullable=False),
        sa.Column('guidance', sa.Text(), nullable=False),
        sa.Column('platforms', sa.JSON(), nullable=False),
        sa.Column('product_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('skipped_years', sa.JSON(), nullable=False),
        sa.Column('last_run_year', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id']),
        sa.ForeignKeyConstraint(['product_id'], ['products.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_agent_events_company_id'), 'agent_events', ['company_id'], unique=False)

    op.create_table(
        'agent_recommendations',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('source_url', sa.String(length=500), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('platforms', sa.JSON(), nullable=False),
        sa.Column('created_ad_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id']),
        sa.ForeignKeyConstraint(['created_ad_id'], ['ads.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_agent_recommendations_company_id'), 'agent_recommendations', ['company_id'], unique=False)

    op.create_table(
        'agent_scrape_jobs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('url', sa.String(length=500), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_agent_scrape_jobs_company_id'), 'agent_scrape_jobs', ['company_id'], unique=False)

    op.add_column('ads', sa.Column('agent_source', sa.String(length=20), nullable=True))
    op.add_column('ads', sa.Column('agent_event_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_ads_agent_event_id', 'ads', 'agent_events', ['agent_event_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('fk_ads_agent_event_id', 'ads', type_='foreignkey')
    op.drop_column('ads', 'agent_event_id')
    op.drop_column('ads', 'agent_source')
    op.drop_index(op.f('ix_agent_scrape_jobs_company_id'), table_name='agent_scrape_jobs')
    op.drop_table('agent_scrape_jobs')
    op.drop_index(op.f('ix_agent_recommendations_company_id'), table_name='agent_recommendations')
    op.drop_table('agent_recommendations')
    op.drop_index(op.f('ix_agent_events_company_id'), table_name='agent_events')
    op.drop_table('agent_events')
