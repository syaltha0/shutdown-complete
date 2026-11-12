# --- build the client ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY client client
# the client imports a few modules it shares with the server (password rules, repeating tasks)
COPY server/src server/src
RUN npm run build -w client
# production dependencies of the server only
RUN rm -rf node_modules && npm ci --omit=dev -w server && npm cache clean --force

# --- run the server ---
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    STATIC_DIR=/app/client/dist
WORKDIR /app
COPY package.json ./
COPY server/package.json server/
COPY --from=build /app/node_modules node_modules
COPY server/src server/src
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.mjs"]
