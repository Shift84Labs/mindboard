FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
ENV PORT=3113
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 3113
CMD ["node", "server.js"]
