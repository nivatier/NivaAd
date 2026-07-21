"""add brand_logos table (multi-logo gallery)

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-07-21 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b4c5d6e7f8a9'
down_revision: Union[str, None] = 'a3b4c5d6e7f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'brand_logos',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('url', sa.String(length=500), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_brand_logos_company_id'), 'brand_logos', ['company_id'], unique=False)

    # Backfill: any company that already has a single logo_url set on its
    # brand_kits row gets that logo carried over as the first (and active)
    # entry in its new gallery — otherwise switching to the gallery system
    # would silently "lose" every company's existing logo from the UI even
    # though brand_kits.logo_url (still the field actually used in ad
    # generation) is untouched. UUIDs generated in Python rather than via
    # gen_random_uuid() so this doesn't depend on any particular Postgres
    # version/extension being available.
    import uuid as _uuid
    from datetime import datetime as _datetime

    conn = op.get_bind()
    brand_logos = sa.table(
        'brand_logos',
        sa.column('id', postgresql.UUID(as_uuid=True)),
        sa.column('company_id', postgresql.UUID(as_uuid=True)),
        sa.column('url', sa.String),
        sa.column('created_at', sa.DateTime),
    )
    rows = conn.execute(sa.text("SELECT company_id, logo_url FROM brand_kits WHERE logo_url IS NOT NULL")).fetchall()
    if rows:
        conn.execute(
            brand_logos.insert(),
            [{"id": _uuid.uuid4(), "company_id": r[0], "url": r[1], "created_at": _datetime.utcnow()} for r in rows],
        )


def downgrade() -> None:
    op.drop_index(op.f('ix_brand_logos_company_id'), table_name='brand_logos')
    op.drop_table('brand_logos')
