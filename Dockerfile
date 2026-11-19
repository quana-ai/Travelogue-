# ==========================================
# 1. Backend Build Stage
# ==========================================
FROM node:20-bookworm-slim AS backend-builder

WORKDIR /app/backend

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
COPY backend/prisma ./prisma/

RUN npm install
RUN npx prisma generate

COPY backend/ ./
RUN npm run build

# ==========================================
# 2. Frontend Build Stage
# ==========================================
FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./

# In unified container, API calls use same-origin relative /api path
ARG NEXT_PUBLIC_API_BASE=/api
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}

RUN npm run build

# ==========================================
# 3. Unified Monorepo Runner Stage
# ==========================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install system dependencies: OpenSSL (for Prisma), Nginx (reverse proxy), Supervisor (process manager)
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    nginx \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV UPLOAD_DIR=/app/uploads

# Create directories for uploads, database, and logging
RUN mkdir -p /app/uploads /app/prisma /var/log/supervisor /var/log/nginx

# Copy compiled backend
COPY --from=backend-builder /app/backend/package*.json ./backend/
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/prisma ./backend/prisma

# Copy compiled frontend
COPY --from=frontend-builder /app/frontend/package*.json ./frontend/
COPY --from=frontend-builder /app/frontend/node_modules ./frontend/node_modules
COPY --from=frontend-builder /app/frontend/.next ./frontend/.next
COPY --from=frontend-builder /app/frontend/public ./frontend/public

# Copy Nginx and Supervisor configurations
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose unified port 3000
EXPOSE 3000

# Start Supervisor which runs Backend (4000), Frontend (3001), and Nginx (3000)
CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

