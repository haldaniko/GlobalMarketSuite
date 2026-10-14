FROM node:20-alpine AS base

WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS dev

ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS build

COPY . .
RUN npm run build

FROM node:20-alpine AS prod

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
EXPOSE 3000
CMD ["sh", "-c", "node scripts/write-runtime-config.mjs && npm run start"]
