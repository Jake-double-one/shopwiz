# syntax=docker/dockerfile:1

# the base image is pinned to a digest (Dependabot moves it along) – a tag alone could change under us

# ---- build the client (platform independent, so always on the native build platform) ----
FROM --platform=$BUILDPLATFORM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# build info for the help dialog (set by CI; local builds show "dev")
ARG APP_VERSION=dev
ARG GIT_SHA=
ARG BUILD_TIME=
ARG REPO_URL=https://github.com/Jake-double-one/shopwiz
ENV VITE_APP_VERSION=$APP_VERSION \
    VITE_GIT_SHA=$GIT_SHA \
    VITE_BUILD_TIME=$BUILD_TIME \
    VITE_REPO_URL=$REPO_URL
RUN npm run build

# ---- production dependencies: pure JavaScript (no native modules), so they are installed once
#      natively and copied into every platform's image – npm never runs under emulation ----
FROM --platform=$BUILDPLATFORM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runtime: server + built client, production deps only ----
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
# the same build info for the server: GET /healthz and /api/version tell which version runs
ARG APP_VERSION=dev
ARG GIT_SHA=
ARG BUILD_TIME=
ENV APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
COPY shared ./shared
COPY skins ./skins
COPY --from=build /app/dist ./dist
# your own skins go into /data/skins (see skins/README.md)
RUN mkdir -p /data/skins && chown -R node:node /data
# the container only ever runs "node": npm, npx, corepack and yarn (with their hundreds of packages)
# are not needed at runtime – fewer things for a scanner, or an attacker, to find
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn*
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
