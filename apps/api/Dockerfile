# apps/api Dockerfile — NestJS API + tectonic (LaTeX) + typst render binaries.
# Render's free tier deploys this directly (env: docker in render.yaml).

FROM node:20-bookworm-slim AS base

# ── System deps: certs, curl/tar for binary installs, openssl for Prisma ──
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl tar xz-utils openssl \
    && rm -rf /var/lib/apt/lists/*

# ── tectonic (LaTeX engine) — pinned release tarball, sha256-verified ────────
ENV TECTONIC_VERSION=0.17.0
ENV TECTONIC_SHA256=8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7
RUN curl -fsSL \
      "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
      -o /tmp/tectonic.tar.gz \
    && echo "${TECTONIC_SHA256}  /tmp/tectonic.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/tectonic.tar.gz -C /tmp \
    && mv /tmp/tectonic /usr/local/bin/tectonic \
    && rm -f /tmp/tectonic.tar.gz \
    && chmod +x /usr/local/bin/tectonic

# ── typst — pinned release tarball, sha256-verified ──────────────────────────
ENV TYPST_VERSION=0.15.1
ENV TYPST_SHA256=a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c
RUN curl -fsSL \
      "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz" \
      -o /tmp/typst.tar.xz \
    && echo "${TYPST_SHA256}  /tmp/typst.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/typst.tar.xz -C /tmp \
    && mv "/tmp/typst-x86_64-unknown-linux-musl/typst" /usr/local/bin/typst \
    && rm -rf /tmp/typst.tar.xz "/tmp/typst-x86_64-unknown-linux-musl" \
    && chmod +x /usr/local/bin/typst

WORKDIR /repo

# ── Install workspace deps (root lockfile drives the whole monorepo) ────────
COPY package.json package-lock.json turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/ai-bridge/package.json packages/ai-bridge/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/resume-renderer/package.json packages/resume-renderer/package.json
RUN npm ci

# ── Build only what the API needs ────────────────────────────────────────────
COPY apps/api apps/api
COPY packages/ai-bridge packages/ai-bridge
COPY packages/schemas packages/schemas
COPY packages/resume-renderer packages/resume-renderer
COPY turbo.json ./
RUN npx turbo build --filter=@resumiq/api

ENV NODE_ENV=production
EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/main.js"]
