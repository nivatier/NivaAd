"""agent_recommendation enhancements — voice, reference_style, product_id, saved status

Revision ID: t8u9v0w1x2y3
Revises: s7t8u9v0w1x2
Create Date: 2026-08-06

Adds:
  - voice          (str, nullable) — "we" | "i" | "neutral" | "you"
  - reference_style (str, nullable) — "none" | "start" | "end"
  - product_id     (UUID FK → products, nullable) — per-card product override
  Status column already supports arbitrary strings; "saved" is a new
  logical status (pending → saved → created/dismissed) — no schema change
  needed for status itself.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "t8u9v0w1x2y3"
down_revision = "s7t8u9v0w1x2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_recommendations", sa.Column("voice", sa.String(20), nullable=True))
    op.add_column("agent_recommendations", sa.Column("reference_style", sa.String(20), nullable=True))
    op.add_column(
        "agent_recommendations",
        sa.Column("product_id", UUID(as_uuid=True), sa.ForeignKey("products.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_recommendations", "product_id")
    op.drop_column("agent_recommendations", "reference_style")
    op.drop_column("agent_recommendations", "voice")
