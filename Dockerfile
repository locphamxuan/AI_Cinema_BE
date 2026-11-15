
FROM node:24-bookworm-slim AS base
WORKDIR /app

# Prisma needs OpenSSL; FFmpeg/ffprobe process delivered episodes.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ffmpeg && rm -rf /var/lib/apt/lists/*

# Install dependencies and generate Prisma Client.
FROM base AS deps

COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma

ENV NODE_ENV=development

RUN npm ci --include=dev

RUN npm ls tsx prisma @prisma/client

# Migration and seed stage.
FROM deps AS migrate
COPY tsconfig.json ./
COPY src ./src

RUN echo "=== NODE_ENV=$NODE_ENV ===" \
  && ls -la node_modules/.bin/tsx 2>&1 || true \
  && ls -d node_modules/tsx 2>&1 || true \
  && npm ls tsx 2>&1 || true

RUN test -x node_modules/.bin/tsx \
 || npm install --no-save --include=dev tsx prisma

CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

# Build the NestJS application.
FROM deps AS build

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN npm run build \
    && npm prune --omit=dev --ignore-scripts

# Production API image.
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./

RUN mkdir -p /app/storage && chown node:node /app/storage

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
