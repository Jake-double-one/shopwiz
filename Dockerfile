# syntax=docker/dockerfile:1

# the base image is pinned to a digest (Dependabot moves it along) – a tag alone could change under us

# ---- build the client (platform independent, so always on the native build platform) ----
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS build
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
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runtime: server + built client, production deps only ----
FROM node:26-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5
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
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
