# Build from the repo root: docker build -f apps/dashboard/Dockerfile .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/demo/package.json packages/demo/
COPY apps/dashboard/package.json apps/dashboard/
RUN pnpm install --frozen-lockfile --filter @smart-cart/dashboard...
COPY packages packages
COPY apps/api/src/smartcart/data/products.csv apps/api/src/smartcart/data/sections.json apps/api/src/smartcart/data/offers.csv apps/api/src/smartcart/data/
COPY apps/dashboard apps/dashboard
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_STORE_ID=S-01
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_STORE_ID=$NEXT_PUBLIC_STORE_ID
RUN pnpm --filter "./packages/*" build && pnpm --filter @smart-cart/dashboard build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/dashboard/.next/standalone ./
COPY --from=build /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
