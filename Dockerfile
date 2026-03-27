FROM node:20-alpine AS base
WORKDIR /app

FROM base AS build
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY src ./src
COPY ui ./ui
RUN npm run build

FROM base AS production-deps
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    TORRENT_GRAIN_HOST=0.0.0.0 \
    TORRENT_GRAIN_PORT=32101 \
    TORRENT_GRAIN_DATA_DIR=/data
COPY package*.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/ui-dist ./ui-dist
VOLUME ["/data"]
EXPOSE 32101
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:32101/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]
CMD ["node", "dist/index.js"]
