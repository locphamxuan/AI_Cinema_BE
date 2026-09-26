# API image: `docker compose up` builds it (see docker-compose.yml).
FROM node:22-bookworm-slim AS base
WORKDIR /app
# Prisma's query engine needs OpenSSL; FFmpeg renders the HLS ladder (VIDEO_TRANSCODER=ffmpeg).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ffmpeg && rm -rf /var/lib/apt/lists/*

# All dependencies; `npm ci` also generates the Prisma client (postinstall).
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# Migrations and seed run from here (they need the Prisma CLI and tsx).
FROM deps AS migrate
COPY tsconfig.json ./
COPY src ./src
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/main"]
