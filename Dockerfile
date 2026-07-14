# ---------- Build stage: install all deps, compile server (tsc) + client (vite) ----------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- Runtime stage: production deps + build output only ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=60628 \
    STORAGE_DRIVER=local \
    AUTH_DISABLED=true \
    WORKFLOW_SEED_ON_INIT=true \
    DEMO_SEED_ON_INIT=false

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled server (dist/src/...) + bundled client (dist/client)
COPY --from=build /app/dist ./dist
# Demo workbooks are only needed when DEMO_SEED_ON_INIT=true.
COPY database ./database

EXPOSE 60628
CMD ["node", "dist/src/server/server.js"]
