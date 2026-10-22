# Smart Cart API

Python 3.12 service for carts, the catalogue, inventory and real-time events.

- **FastAPI** for REST (`/v1/...` for shoppers, `/admin/v1/...` for store staff).
- **SQLAlchemy 2 (async) + Alembic** on PostgreSQL. `migrations/` holds the schema history.
- **Redis** keeps each live cart (`cart:<sessionId>:items`); the `cart_events` table is the durable
  log, and the live cart is rebuilt from it if Redis loses the key.
- **python-socketio** pushes events to rooms `cart:<sessionId>` (the shopper) and
  `store:<storeId>` (staff), through Redis so several API instances can run side by side.

Every response and pushed event follows `packages/contracts`, and the tests check that.

## Layout

```
src/smartcart/
  app.py            builds the ASGI app (FastAPI + Socket.IO), background idle-cart sweeper
  config.py         settings from the environment / .env
  auth.py           Firebase ID tokens, or dev tokens before Firebase exists
  cart_service.py   pair, add, remove, cancel, idle sweep; stock reservations; event publishing
  realtime.py       Socket.IO auth and room joins
  money.py          integer paise, GST extracted from inclusive prices
  models.py         tables
  routes/           HTTP endpoints
  seed.py           demo store, 20 carts, 213 products from data/products.csv
migrations/         Alembic
tests/              pytest; integration tests need Postgres and Redis with the seed loaded
```

## Commands

```sh
uv sync                              # install (creates .venv with Python 3.12)
uv run alembic upgrade head          # migrate
uv run python -m smartcart.seed      # demo data (safe to re-run)
uv run python -m smartcart.main      # serve on :4000
uv run pytest                        # tests
uv run ruff check . && uv run mypy src tests migrations
```

After changing `models.py`, create a migration with `uv run alembic revision --autogenerate -m "..."`
and check it by hand; CI runs `alembic check` to catch models and migrations drifting apart.
