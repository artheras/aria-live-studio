# syntax=docker/dockerfile:1
# Aria Live Studio server + built dashboard/overlay, for hosting where ChatGPT
# and Claude can reach the MCP connector URLs (see README: Hosting for ChatGPT
# and Claude). Run behind HTTPS and set PUBLIC_URL to the public https:// URL.
#
#   docker build -t aria-live-studio .
#   docker run -p 3000:3000 -v aria-live-data:/data --env-file .env \
#     -e PUBLIC_URL=https://live.example.com -e TRUST_PROXY=1 aria-live-studio
#
# Behind a TLS-intercepting proxy, pass its CA for npm only (not kept in the image):
#   docker build --secret id=npm_ca,src=/path/to/ca.crt -t aria-live-studio .

ARG NODE_IMAGE=node:22-bookworm-slim

# ── build: install everything, build the web app (and the MCP bridge) ──────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/mcp/package.json packages/mcp/
RUN --mount=type=secret,id=npm_ca,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/npm_ca ] && echo /run/secrets/npm_ca) \
    npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
RUN npm run build

# ── deps: production dependencies only (tsx runs the TypeScript server) ────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/mcp/package.json packages/mcp/
RUN --mount=type=secret,id=npm_ca,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/npm_ca ] && echo /run/secrets/npm_ca) \
    npm ci --omit=dev --no-audit --no-fund --ignore-scripts && npm cache clean --force

# ── runtime ────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/mcp/package.json packages/mcp/tsconfig.json packages/mcp/
COPY packages/mcp/src packages/mcp/src
COPY packages/server/package.json packages/server/tsconfig.json packages/server/
COPY packages/server/src packages/server/src
COPY packages/web/package.json packages/web/
COPY --from=build /app/packages/web/dist packages/web/dist
COPY plugin plugin
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--import", "tsx", "packages/server/src/main.ts"]
