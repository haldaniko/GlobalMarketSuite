FROM node:24-alpine AS base

WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS dev

ENV NODE_ENV=development
COPY . .
EXPOSE 4000
CMD ["npm", "run", "dev"]

FROM base AS build

COPY . .
RUN npm run build

FROM node:24-alpine AS prod

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
EXPOSE 4000
CMD ["npm", "run", "start"]
