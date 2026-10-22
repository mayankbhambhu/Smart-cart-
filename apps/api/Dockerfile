# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS build
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @smart-cart/api...
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @smart-cart/contracts build && pnpm --filter @smart-cart/api build
# A self-contained copy of the API with production dependencies only (includes dist/ and prisma/).
RUN pnpm --filter @smart-cart/api deploy --prod --legacy /out \
  && cd /out && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 4000
# Migrations:  node_modules/.bin/prisma migrate deploy
# Demo seed:   node dist/prisma/seed.js
CMD ["node", "dist/src/main.js"]
