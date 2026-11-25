# Builds the images from one context:
#   docker build --target kith -t kith .         (server + app)
#   docker build --target desk -t kith-desk .    (the companion's offline desk, with its read-only browser)
#   docker build --target egress -t kith-egress .  (the desk browser's only way out: the safe list)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY desk/package.json desk/
COPY egress/package.json egress/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Playwright's image ships Chromium and Node; the version must match playwright-core in desk/package.json.
FROM mcr.microsoft.com/playwright:v1.65.0-noble AS desk
WORKDIR /app
ENV NODE_ENV=production DESK_DIR=/desk DESK_PORT=8790 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY desk/package.json desk/
COPY egress/package.json egress/
RUN npm ci --omit=dev --workspace desk --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/desk/dist desk/dist
RUN mkdir -p /desk && chown pwuser:pwuser /desk
WORKDIR /app/desk
USER pwuser
EXPOSE 8790
CMD ["node", "dist/index.js"]

FROM node:22-alpine AS egress
WORKDIR /app
ENV NODE_ENV=production EGRESS_PORT=3128
COPY --from=build /app/egress/dist ./dist
COPY egress/package.json ./
USER node
EXPOSE 3128
CMD ["node", "dist/index.js"]

FROM node:22-alpine AS kith
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY desk/package.json desk/
COPY egress/package.json egress/
RUN npm ci --omit=dev --workspace server --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /data && chown node:node /data
WORKDIR /app/server
ENV KITH_CLIENT_DIR=/app/client/dist KITH_DATA_DIR=/data PORT=8787
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/public/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
