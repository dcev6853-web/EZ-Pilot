# Multi-stage build for smaller production image
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY prisma ./prisma
RUN npm run db:generate && npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && apk add --no-cache dumb-init
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
USER node
EXPOSE 5000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
