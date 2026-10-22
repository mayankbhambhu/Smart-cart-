"""V1 schema: stores, catalogue, inventory, carts, sessions, events, orders, payments.

The SQL is the schema the project started with (milestone 1), kept verbatim so existing
databases and new ones are identical.

Revision ID: 0001
Revises:
"""

from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SQL = Path(__file__).parent.parent / "sql"


def _run(name: str) -> None:
    for statement in (SQL / name).read_text().split(";"):
        if statement.strip() and not all(
            line.strip().startswith("--") or not line.strip() for line in statement.splitlines()
        ):
            op.execute(statement)


def upgrade() -> None:
    _run("0001_init.sql")


def downgrade() -> None:
    op.execute(
        "DROP TABLE IF EXISTS payments, order_items, orders, cart_events, cart_sessions, carts, "
        "stock_movements, inventory, store_prices, barcodes, products, staff, users, stores CASCADE"
    )
    for t in (
        "PaymentStatus",
        "OrderStatus",
        "EventSource",
        "CartSessionStatus",
        "CartStatus",
        "StockReason",
        "StaffRole",
    ):
        op.execute(f'DROP TYPE IF EXISTS "{t}"')
