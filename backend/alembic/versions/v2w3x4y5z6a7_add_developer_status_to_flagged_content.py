"""add developer_status to flagged_content

Revision ID: v2w3x4y5z6a7
Revises: u1v2w3x4y5z6
Create Date: 2026-08-13

Adds a developer_status column to flagged_content so the platform
developer can review/archive flags independently of the company admin's
own resolved field. The two actions are now fully separate:

  resolved          → company admin action (unchanged)
  developer_status  → developer action: open | reviewed | archived
"""
from alembic import op
import sqlalchemy as sa

revision = "v2w3x4y5z6a7"
down_revision = "u1v2w3x4y5z6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "flagged_content",
        sa.Column(
            "developer_status",
            sa.String(20),
            nullable=False,
            server_default="open",
        ),
    )


def downgrade() -> None:
    op.drop_column("flagged_content", "developer_status")
