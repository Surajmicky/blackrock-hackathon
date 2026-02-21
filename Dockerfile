# docker build -t blk-hacking-ind-suraj-kumar .
# Base image selection criteria: Alpine Linux (small attack surface, fast pull/build, widely supported)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 5477
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD curl -f http://localhost:5477/health || exit 1
CMD ["node", "dist/server.js"]
