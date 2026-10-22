# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM python:3.12-slim-bookworm AS build
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY apps/api/pyproject.toml apps/api/uv.lock apps/api/README.md ./
RUN uv sync --locked --no-dev --no-install-project
COPY apps/api/src src
RUN uv sync --locked --no-dev --no-editable

FROM python:3.12-slim-bookworm
RUN useradd --system --uid 1001 app
WORKDIR /app
COPY --from=build /app/.venv .venv
COPY apps/api/alembic.ini ./
COPY apps/api/migrations migrations
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 ENV=production
USER app
EXPOSE 4000
# Migrations and demo seed:  alembic upgrade head && python -m smartcart.seed
CMD ["python", "-m", "smartcart.main"]
