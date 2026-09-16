FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js auth.js ./
COPY public ./public
# data dir must be node-owned before VOLUME so new volumes inherit it
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production
ENV PORT=3113
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 3113
CMD ["node", "server.js"]
