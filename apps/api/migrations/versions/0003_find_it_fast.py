"""Find it fast: diet tags, search log (missed searches) and help requests.

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "search_logs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("store_id", sa.Text(), nullable=False),
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("result_count", sa.Integer(), nullable=False),
        sa.Column("at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("search_logs_store_at_idx", "search_logs", ["store_id", "at"], unique=False)
    op.create_table(
        "help_requests",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("store_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("cart_id", sa.Text(), nullable=True),
        sa.Column("aisle", sa.Text(), nullable=True),
        sa.Column("topic", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("open", "acknowledged", "resolved", "cancelled", name="HelpStatus"),
            server_default="open",
            nullable=False,
        ),
        sa.Column("handled_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["cart_id"], ["carts.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["handled_by"], ["users.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("help_requests_store_status_idx", "help_requests", ["store_id", "status"], unique=False)
    op.add_column(
        "products", sa.Column("diet_tags", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False)
    )


def downgrade() -> None:
    op.drop_column("products", "diet_tags")
    op.drop_index("help_requests_store_status_idx", table_name="help_requests")
    op.drop_table("help_requests")
    op.drop_index("search_logs_store_at_idx", table_name="search_logs")
    op.drop_table("search_logs")
    op.execute('DROP TYPE IF EXISTS "HelpStatus"')
