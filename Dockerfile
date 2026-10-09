# API image: `docker compose up` builds it locally; CI builds the `runtime` target and pushes it to GHCR.
FROM node:24-bookworm-slim AS base
WORKDIR /app
# Prisma needs OpenSSL; FFmpeg/ffprobe turn delivered episodes into the HLS ladder (MEDIA_PIPELINE=ffmpeg).
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
# Local storage driver (STORAGE_DRIVER=local) writes uploads and HLS renditions here.
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3   CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main"]
