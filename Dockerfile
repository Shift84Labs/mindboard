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
# shown in the settings screen: docker build --build-arg APP_COMMIT=$(git rev-parse --short HEAD)
ARG APP_COMMIT=
ENV APP_COMMIT=$APP_COMMIT
ENV PORT=3113
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 3113
CMD ["node", "server.js"]
