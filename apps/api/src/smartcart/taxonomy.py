"""The store's sections and the categories inside them, as shoppers browse them in the app.

data/sections.json is the single list, read here for the seed and by the demo builds' catalogue
generator. Managers can move products between categories and correct food labels from the dashboard.
"""

import json
from pathlib import Path

_DATA = json.loads((Path(__file__).parent / "data" / "sections.json").read_text(encoding="utf-8"))

# (id, name, icon, [category names in shelf order])
SECTIONS: list[tuple[str, str, str, list[str]]] = [
    (s["id"], s["name"], s["icon"], list(s["categories"])) for s in _DATA
]


def category_id(section_id: str, name: str) -> str:
    """Stable id for a seeded category, e.g. "dairy-eggs/curd-and-dahi"."""
    return f"{section_id}/{name.lower().replace(' ', '-')}"


# Food labels as printed on Indian packs (FSSAI): a green dot is veg, a brown dot non-veg. Egg
# products carry the brown dot too; the app adds an "egg" tag so vegetarians who eat eggs can tell.
FOOD_TYPES = ("veg", "non_veg", "egg", "not_food")
# Claims a shopper can filter by. Only what the pack states; never inferred from ingredients.
DIET_TAGS = ("jain", "vegan", "gluten_free", "sugar_free", "no_added_sugar")
