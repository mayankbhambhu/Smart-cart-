"""One open session per cart and per shopper (partial unique indexes).

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE UNIQUE INDEX "cart_sessions_one_open_per_cart" ON "cart_sessions" ("cart_id")
           WHERE "status" IN ('active', 'checking_out')"""
    )
    op.execute(
        """CREATE UNIQUE INDEX "cart_sessions_one_open_per_user" ON "cart_sessions" ("user_id")
           WHERE "status" IN ('active', 'checking_out')"""
    )


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS "cart_sessions_one_open_per_user"')
    op.execute('DROP INDEX IF EXISTS "cart_sessions_one_open_per_cart"')
