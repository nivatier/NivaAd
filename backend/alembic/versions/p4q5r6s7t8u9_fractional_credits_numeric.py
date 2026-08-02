"""fractional credits — change delta and credits_cost to NUMERIC(10,2)

Revision ID: p4q5r6s7t8u9
Revises: o3p4q5r6s7t8
Create Date: 2026-08-02

Changes:
  credit_ledger.delta        INTEGER  →  NUMERIC(10, 2)
  generation_jobs.credits_cost INTEGER →  NUMERIC(10, 2)

Rationale: the credit system now supports 0.25-step fractional credits
(e.g. 0.25, 0.5, 1.25, 2.75) so both the ledger delta and the job cost
must be able to store non-integer values. NUMERIC(10, 2) gives us up to
99,999,999.99 credits with exactly 2 decimal places — more than enough
precision for 0.25-step charging, and safe from float rounding errors.

Existing integer rows are preserved exactly — Postgres casts INTEGER to
NUMERIC(10,2) without any data loss (1 becomes 1.00, -4 becomes -4.00).
No backfill needed; old rows continue to read and sum correctly.
"""
from alembic import op
import sqlalchemy as sa

# Alembic required variables
revision = "p4q5r6s7t8u9"
down_revision = "o3p4q5r6s7t8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # credit_ledger.delta: INTEGER → NUMERIC(10, 2)
    op.alter_column(
        "credit_ledger",
        "delta",
        type_=sa.Numeric(precision=10, scale=2),
        existing_type=sa.Integer(),
        existing_nullable=False,
        postgresql_using="delta::numeric(10,2)",
    )

    # generation_jobs.credits_cost: INTEGER → NUMERIC(10, 2)
    op.alter_column(
        "generation_jobs",
        "credits_cost",
        type_=sa.Numeric(precision=10, scale=2),
        existing_type=sa.Integer(),
        existing_nullable=False,
        existing_server_default="1",
        postgresql_using="credits_cost::numeric(10,2)",
    )


def downgrade() -> None:
    # Round back to INTEGER on downgrade — fractional values truncate,
    # which is acceptable since downgrade implies removing fractional
    # pricing; no partial credits would exist at that point.
    op.alter_column(
        "generation_jobs",
        "credits_cost",
        type_=sa.Integer(),
        existing_type=sa.Numeric(precision=10, scale=2),
        existing_nullable=False,
        existing_server_default="1",
        postgresql_using="credits_cost::integer",
    )

    op.alter_column(
        "credit_ledger",
        "delta",
        type_=sa.Integer(),
        existing_type=sa.Numeric(precision=10, scale=2),
        existing_nullable=False,
        postgresql_using="delta::integer",
    )
