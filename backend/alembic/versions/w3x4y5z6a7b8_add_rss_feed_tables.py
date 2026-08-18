"""add rss feed tables

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-08-17

Adds four new tables for the RSS Feed Auto-Posting feature inside Agent Niva:

  rss_feeds             — developer-managed global feed catalogue
  rss_feed_subscriptions — per-company subscription + all posting settings
  rss_feed_seen_items   — deduplication: tracks article URLs already processed
  rss_feed_drafts       — pending posts awaiting manual approval (expire 24h)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "w3x4y5z6a7b8"
down_revision = "v2w3x4y5z6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── rss_feeds ──────────────────────────────────────────────────────────
    op.create_table(
        "rss_feeds",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("category", sa.String(80), nullable=False, server_default="General"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("url", name="uq_rss_feeds_url"),
    )

    # ── rss_feed_subscriptions ──────────────────────────────────────────────
    op.create_table(
        "rss_feed_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("rss_feed_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("rss_feeds.id"), nullable=True),
        sa.Column("custom_url", sa.String(500), nullable=True),
        sa.Column("label", sa.String(200), nullable=False, server_default=""),
        sa.Column("content_type", sa.String(20), nullable=False, server_default="text"),
        sa.Column("image_model_id", sa.String(120), nullable=True),
        sa.Column("video_model_id", sa.String(120), nullable=True),
        sa.Column("platforms", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("posting_mode", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("frequency", sa.String(20), nullable=False, server_default="daily"),
        sa.Column("day_of_week", sa.Integer(), nullable=True),
        sa.Column("day_of_month", sa.Integer(), nullable=True),
        sa.Column("posts_per_run", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("article_selection", sa.String(40), nullable=False, server_default="most_recent"),
        sa.Column("tone_style", sa.String(30), nullable=False, server_default="curator"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column("next_run_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_rss_feed_subscriptions_company_id", "rss_feed_subscriptions", ["company_id"])

    # ── rss_feed_seen_items ─────────────────────────────────────────────────
    op.create_table(
        "rss_feed_seen_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "subscription_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("rss_feed_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("article_url", sa.String(500), nullable=False),
        sa.Column("seen_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_rss_feed_seen_items_subscription_id", "rss_feed_seen_items", ["subscription_id"])
    op.create_index("ix_rss_feed_seen_items_seen_at", "rss_feed_seen_items", ["seen_at"])

    # ── rss_feed_drafts ─────────────────────────────────────────────────────
    op.create_table(
        "rss_feed_drafts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column(
            "subscription_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("rss_feed_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("article_url", sa.String(500), nullable=False),
        sa.Column("article_title", sa.String(500), nullable=False, server_default=""),
        sa.Column("article_summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("ad_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ads.id"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_rss_feed_drafts_company_id", "rss_feed_drafts", ["company_id"])
    op.create_index("ix_rss_feed_drafts_expires_at", "rss_feed_drafts", ["expires_at"])


def downgrade() -> None:
    op.drop_table("rss_feed_drafts")
    op.drop_table("rss_feed_seen_items")
    op.drop_table("rss_feed_subscriptions")
    op.drop_table("rss_feeds")
