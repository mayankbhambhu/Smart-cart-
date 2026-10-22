"""Offers: a manager's deal on a product for a time window (aisle deal alerts).

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "offers",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("store_id", sa.Text(), nullable=False),
        sa.Column("product_id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("offer_price_paise", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], onupdate="CASCADE", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("offers_store_ends_idx", "offers", ["store_id", "ends_at"])


def downgrade() -> None:
    op.drop_index("offers_store_ends_idx", table_name="offers")
    op.drop_table("offers")
