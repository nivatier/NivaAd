"""add website_streaks and streak_ads tables

Revision ID: a1b2c3d4e5f6
Revises: z6a7b8c9d0e1
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSON

revision = 'a1b2c3d4e5f6'
down_revision = 'z6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'website_streaks',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('url', sa.String(500), nullable=False),
        sa.Column('site_name', sa.String(200), nullable=False, server_default=''),
        sa.Column('streak_type', sa.String(20), nullable=False, server_default='one_month'),
        sa.Column('total_ads', sa.Integer(), nullable=False, server_default='30'),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('scraped_content', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )

    op.create_table(
        'streak_ads',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('streak_id', UUID(as_uuid=True), sa.ForeignKey('website_streaks.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('title', sa.String(300), nullable=False, server_default=''),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('ad_copy', sa.Text(), nullable=False, server_default=''),
        sa.Column('image_prompt', sa.Text(), nullable=False, server_default=''),
        sa.Column('audience', sa.String(200), nullable=False, server_default=''),
        sa.Column('voice', sa.String(30), nullable=False, server_default='we'),
        sa.Column('platforms', JSON(), nullable=False, server_default='[]'),
        sa.Column('scheduled_date', sa.String(10), nullable=True),
        sa.Column('scheduled_time', sa.String(5), nullable=True),
        sa.Column('timezone', sa.String(60), nullable=False, server_default='UTC'),
        sa.Column('status', sa.String(20), nullable=False, server_default='idea', index=True),
        sa.Column('ad_id', UUID(as_uuid=True), sa.ForeignKey('ads.id'), nullable=True),
        sa.Column('failure_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('streak_ads')
    op.drop_table('website_streaks')
