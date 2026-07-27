FROM node:20-alpine
WORKDIR /app
# No runtime dependencies — copy the source and run.
COPY package.json ./
COPY server/ ./server/
COPY lib/ ./lib/
ENV PORT=8787 COGWAIT_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
USER node
CMD ["node", "server/index.js"]
