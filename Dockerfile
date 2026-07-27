# Cubist Souls — production image for the mini/Dokku (post-Vercel migration).
#
# Next 14 standalone output. Multi-stage: deps -> build -> minimal runner.
# node:20-slim (Debian/glibc) NOT alpine on purpose: `sharp` (used by
# /api/render and /api/reaper-img) ships glibc prebuilt binaries that "just
# work" on slim; alpine/musl needs the @img/sharp-linuxmusl-* variant and
# Next's file-tracing is flaky about copying optional native deps. Reliability
# over image size for this emergency migration.
#
# Dokku injects PORT for image deploys (defaults to 5000); server.js honours it.
# NO secrets in the image — UPSTASH_REDIS_REST_URL / _TOKEN come from
# `dokku config` at runtime (see NOTES.md).

# ---- deps: install full deps once (cached on package*.json) -----------------
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compile the standalone server --------------------------------
FROM node:20-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: minimal runtime image -----------------------------------------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Dokku image deploys expose 5000 by default; keep PORT overridable.
ENV PORT=5000
ENV HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone server + its traced node_modules, the built static assets, and the
# public dir (reaper-img/render read SVGs from process.cwd()/public at runtime).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Belt-and-suspenders: guarantee sharp's native binaries are present in the
# runtime (Next's tracing sometimes drops the optional @img/sharp-* packages).
# Copied from the builder, so the glibc binaries match this base image exactly.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img

USER nextjs
EXPOSE 5000
CMD ["node", "server.js"]
