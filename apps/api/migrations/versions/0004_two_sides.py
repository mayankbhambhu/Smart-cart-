"""Two sides: store-team accounts and their approval, reservations, staff tasks, stock corrections.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


NEW_TYPES = (
    "StaffStatus",
    "StaffRequestType",
    "StaffRequestStatus",
    "ReservationStatus",
    "TaskType",
    "TaskStatus",
)


def upgrade() -> None:
    # Floor assistants were "clerk" in the first schema; the architecture calls them floor_staff.
    op.execute("""ALTER TYPE "StaffRole" RENAME VALUE 'clerk' TO 'floor_staff'""")
    postgresql.ENUM("active", "suspended", "deactivated", name="StaffStatus").create(op.get_bind())
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Text(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target", sa.Text(), nullable=True),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("audit_log_at_idx", "audit_log", ["at"], unique=False)
    op.create_table(
        "stock_corrections",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("store_id", sa.Text(), nullable=False),
        sa.Column("product_id", sa.Text(), nullable=False),
        sa.Column("system_qty", sa.Integer(), nullable=False),
        sa.Column("counted_qty", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("staff_user_id", sa.Text(), nullable=True),
        sa.Column("at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["staff_user_id"], ["users.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("stock_corrections_store_at_idx", "stock_corrections", ["store_id", "at"], unique=False)
    op.create_table(
        "reservations",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("store_id", sa.Text(), nullable=False),
        sa.Column("slot_start", sa.DateTime(), nullable=False),
        sa.Column("slot_end", sa.DateTime(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("reserved", "picked", "collected", "expired", "cancelled", name="ReservationStatus"),
            server_default="reserved",
            nullable=False,
        ),
        sa.Column("cart_id", sa.Text(), nullable=True),
        sa.Column("picked_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("picked_at", sa.DateTime(), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["cart_id"], ["carts.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["picked_by"], ["users.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "reservations_one_active_per_user",
        "reservations",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('reserved', 'picked')"),
    )
    op.create_index("reservations_store_slot_idx", "reservations", ["store_id", "slot_start"], unique=False)
    op.create_table(
        "staff_requests",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("type", sa.Enum("create", "deactivate", name="StaffRequestType"), nullable=False),
        sa.Column("store_id", sa.Text(), nullable=False),
        sa.Column("requested_by", sa.Text(), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("phone", sa.Text(), nullable=False),
        sa.Column("role", postgresql.ENUM(name="StaffRole", create_type=False), nullable=False),
        sa.Column("shift", sa.Text(), nullable=True),
        sa.Column("employee_ref", sa.Text(), nullable=True),
        sa.Column("staff_id", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("pending", "approved", "rejected", "changes_requested", name="StaffRequestStatus"),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("reviewed_by", sa.Text(), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["staff_id"], ["staff.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("staff_requests_status_idx", "staff_requests", ["status", "created_at"], unique=False)
    op.create_table(
        "staff_tasks",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("store_id", sa.Text(), nullable=False),
        sa.Column(
            "type", sa.Enum("restock", "pick", "stock_check", "other", name="TaskType"), nullable=False
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("ref_id", sa.Text(), nullable=True),
        sa.Column("assigned_to", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("open", "done", "cancelled", name="TaskStatus"),
            server_default="open",
            nullable=False,
        ),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("done_by", sa.Text(), nullable=True),
        sa.Column("done_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["assigned_to"], ["staff.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["done_by"], ["users.id"], onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("staff_tasks_store_status_idx", "staff_tasks", ["store_id", "status"], unique=False)
    op.create_table(
        "reservation_items",
        sa.Column("reservation_id", sa.Text(), nullable=False),
        sa.Column("product_id", sa.Text(), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("picked_qty", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["reservation_id"], ["reservations.id"], onupdate="CASCADE", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("reservation_id", "product_id"),
    )
    op.add_column("staff", sa.Column("staff_code", sa.Text(), nullable=True))
    op.add_column("staff", sa.Column("full_name", sa.Text(), nullable=True))
    op.add_column("staff", sa.Column("phone", sa.Text(), nullable=True))
    op.add_column("staff", sa.Column("shift", sa.Text(), nullable=True))
    op.add_column("staff", sa.Column("employee_ref", sa.Text(), nullable=True))
    op.add_column("staff", sa.Column("password_hash", sa.Text(), nullable=True))
    op.add_column(
        "staff", sa.Column("must_change_password", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column("staff", sa.Column("temp_password_expires_at", sa.DateTime(), nullable=True))
    op.add_column("staff", sa.Column("failed_logins", sa.Integer(), server_default="0", nullable=False))
    op.add_column("staff", sa.Column("locked_until", sa.DateTime(), nullable=True))
    op.add_column(
        "staff",
        sa.Column(
            "status",
            postgresql.ENUM(name="StaffStatus", create_type=False),
            server_default="active",
            nullable=False,
        ),
    )
    op.add_column(
        "staff",
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )
    op.create_index("staff_phone_key", "staff", ["phone"], unique=True)
    op.create_index("staff_staff_code_key", "staff", ["staff_code"], unique=True)


def downgrade() -> None:
    op.drop_index("staff_staff_code_key", table_name="staff")
    op.drop_index("staff_phone_key", table_name="staff")
    op.drop_column("staff", "created_at")
    op.drop_column("staff", "status")
    op.drop_column("staff", "locked_until")
    op.drop_column("staff", "failed_logins")
    op.drop_column("staff", "temp_password_expires_at")
    op.drop_column("staff", "must_change_password")
    op.drop_column("staff", "password_hash")
    op.drop_column("staff", "employee_ref")
    op.drop_column("staff", "shift")
    op.drop_column("staff", "phone")
    op.drop_column("staff", "full_name")
    op.drop_column("staff", "staff_code")
    op.drop_table("reservation_items")
    op.drop_index("staff_tasks_store_status_idx", table_name="staff_tasks")
    op.drop_table("staff_tasks")
    op.drop_index("staff_requests_status_idx", table_name="staff_requests")
    op.drop_table("staff_requests")
    op.drop_index("reservations_store_slot_idx", table_name="reservations")
    op.drop_index(
        "reservations_one_active_per_user",
        table_name="reservations",
        postgresql_where=sa.text("status IN ('reserved', 'picked')"),
    )
    op.drop_table("reservations")
    op.drop_index("stock_corrections_store_at_idx", table_name="stock_corrections")
    op.drop_table("stock_corrections")
    op.drop_index("audit_log_at_idx", table_name="audit_log")
    op.drop_table("audit_log")
    for name in NEW_TYPES:
        op.execute(f'DROP TYPE IF EXISTS "{name}"')
    op.execute("""ALTER TYPE "StaffRole" RENAME VALUE 'floor_staff' TO 'clerk'""")
