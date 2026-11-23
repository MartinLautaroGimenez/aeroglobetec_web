FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
ENV NODE_ENV=production PORT=1234
EXPOSE 1234
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:1234/salud || exit 1
CMD ["node", "server.js"]
