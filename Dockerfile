# syntax=docker/dockerfile:1

# ---- build: instala dependencias, genera el cliente Prisma y compila Nest ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# prisma.config.ts lee DATABASE_URL; para generate basta un valor ficticio
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate \
  && npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Se conservan las devDependencies: `prisma migrate deploy` y el seed corren al arrancar
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json prisma.config.ts tsconfig.json ./
USER node
EXPOSE 3000
# Aplica migraciones, siembra catálogos (idempotente) y levanta la API
CMD ["sh", "-c", "npx prisma migrate deploy && npx ts-node prisma/seed.ts && node dist/src/main.js"]
