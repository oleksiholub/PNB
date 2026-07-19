# --- PNB Backend Dockerfile (multi-stage, Node.js 20, Cloud Run target) ---
# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: production runtime (distroless-style minimal footprint)
FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Non-root user for security hardening
RUN addgroup -S pnb && adduser -S pnb -G pnb

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER pnb

# Cloud Run injects PORT; default provided for local/manual runs only.
ENV PORT=8080
EXPOSE 8080

# No secrets baked into image. All secrets resolved at runtime via Secret Manager.
CMD ["node", "dist/server.js"]
