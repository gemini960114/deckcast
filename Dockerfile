# ─────────────────────────────────────────────
# Stage 1: install dependencies
# ─────────────────────────────────────────────
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

# ─────────────────────────────────────────────
# Stage 2: build
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat
WORKDIR /app

ARG NEXT_PUBLIC_AUTH_ENABLED=false
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ARG NEXT_PUBLIC_VIDEO_EXPORT_ENABLED=false

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_AUTH_ENABLED=${NEXT_PUBLIC_AUTH_ENABLED}
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID}
ENV NEXT_PUBLIC_VIDEO_EXPORT_ENABLED=${NEXT_PUBLIC_VIDEO_EXPORT_ENABLED}
# Increase Node.js memory for large Next.js builds
ENV NODE_OPTIONS="--max_old_space_size=2048"

RUN npm run build

# ─────────────────────────────────────────────
# Stage 3: production runner (standalone)
# ─────────────────────────────────────────────
FROM node:20-alpine AS runner

# FFmpeg for video export (Step 4.1 / 7.1)
# Installed unconditionally so VIDEO_EXPORT_ENABLED can be toggled without rebuilding the image.
# fontconfig + Noto CJK ensure hard-burned zh-TW subtitles render correctly in the container.
RUN apk add --no-cache libc6-compat ffmpeg fontconfig font-noto-cjk

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# /tmp/video-export for FFmpeg temp files (Cloud Run /tmp is tmpfs, counts against memory quota)
RUN mkdir -p /tmp/video-export && chown nextjs:nodejs /tmp/video-export

# Copy standalone output
COPY --from=builder /app/public                        ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
