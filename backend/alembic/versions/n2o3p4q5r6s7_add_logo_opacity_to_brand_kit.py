"""add logo_opacity to brand_kit

Revision ID: n2o3p4q5r6s7
Revises: m1n2o3p4q5r6
Create Date: 2026-07-29
"""
from alembic import op
import sqlalchemy as sa

revision = "n2o3p4q5r6s7"
down_revision = "m1n2o3p4q5r6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("brand_kits", sa.Column("logo_opacity", sa.Float(), nullable=False, server_default="1.0"))


def downgrade() -> None:
    op.drop_column("brand_kits", "logo_opacity")
