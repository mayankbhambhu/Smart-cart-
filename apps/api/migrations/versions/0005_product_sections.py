"""Product sections: sections, their categories, and food labels on products.

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sections",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("icon", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "categories",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("section_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], onupdate="CASCADE", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("categories_section_id_idx", "categories", ["section_id"], unique=False)
    op.add_column("products", sa.Column("category_id", sa.Text(), nullable=True))
    postgresql.ENUM("veg", "non_veg", "egg", "not_food", name="FoodType").create(op.get_bind())
    op.add_column(
        "products",
        sa.Column("food_type", postgresql.ENUM(name="FoodType", create_type=False), nullable=True),
    )
    op.create_index("products_category_id_idx", "products", ["category_id"], unique=False)
    op.create_foreign_key(
        "products_category_id_fkey",
        "products",
        "categories",
        ["category_id"],
        ["id"],
        onupdate="CASCADE",
        ondelete="SET NULL",
    )
    # Vegetarian is now the product's food type (the pack's green dot), not a diet tag.
    op.execute("UPDATE products SET food_type = 'veg' WHERE 'veg' = ANY(diet_tags)")
    op.execute("UPDATE products SET diet_tags = array_remove(diet_tags, 'veg')")


def downgrade() -> None:
    op.execute("UPDATE products SET diet_tags = array_append(diet_tags, 'veg') WHERE food_type = 'veg'")
    op.drop_constraint("products_category_id_fkey", "products", type_="foreignkey")
    op.drop_index("products_category_id_idx", table_name="products")
    op.drop_column("products", "food_type")
    op.drop_column("products", "category_id")
    op.drop_index("categories_section_id_idx", table_name="categories")
    op.drop_table("categories")
    op.drop_table("sections")
    op.execute('DROP TYPE IF EXISTS "FoodType"')
