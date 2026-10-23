"""Cart hardware telemetry and security alerts (anti-theft and the cart fleet).

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cart_telemetry",
        sa.Column("cart_id", sa.Text(), nullable=False),
        sa.Column("battery_pct", sa.Integer(), nullable=False),
        sa.Column("weight_g", sa.Integer(), nullable=False),
        sa.Column("aisle", sa.Text(), nullable=True),
        sa.Column("faults", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False),
        sa.Column("seen_at", sa.DateTime(), nullable=False),
        sa.Column("mismatch_since", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["cart_id"], ["carts.id"], onupdate="CASCADE", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("cart_id"),
    )
    op.create_table(
        "security_alerts",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("store_id", sa.Text(), nullable=False),
        sa.Column("cart_id", sa.Text(), nullable=False),
        sa.Column("session_id", sa.Text(), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("aisle", sa.Text(), nullable=True),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.Text(), server_default="open", nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("handled_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["cart_id"], ["carts.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["session_id"], ["cart_sessions.id"], onupdate="CASCADE", ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["handled_by"], ["users.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("security_alerts_store_status_idx", "security_alerts", ["store_id", "status"])


def downgrade() -> None:
    op.drop_index("security_alerts_store_status_idx", table_name="security_alerts")
    op.drop_table("security_alerts")
    op.drop_table("cart_telemetry")
