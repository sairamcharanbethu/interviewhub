FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
# tesseract-ocr enables OCR for scanned/image-only PDF resumes (see
# lib/parse/pdf.ts). Page rendering is still out of scope: tesseract alone
# cannot OCR a PDF without page images, so scanned uploads are flagged for
# review rather than silently parsed as empty.
RUN apk add --no-cache tesseract-ocr wget
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
RUN mkdir -p /app/data && chown -R app:app /app/data
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# Ollama runs OUTSIDE this container (on the host or another machine).
# Point OLLAMA_BASE_URL at it (docker-compose.yml defaults to
# http://host.docker.internal:11434); do not add an ollama service here.
# Listen on 0.0.0.0 inside the container; compose binds the host port to
# 127.0.0.1 only, so the app is not exposed on the LAN.
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
