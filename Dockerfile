FROM node:20-alpine

LABEL maintainer="nimoshaw"
LABEL description="WakeMaster - LAN machine management with Wake-on-LAN"

WORKDIR /app

# Copy package files and install deps
COPY package.json package-lock.json* ./
RUN npm ci --production 2>/dev/null || npm install --production

# Copy server and web frontend
COPY server.js ./
COPY public/ ./public/

# Data volume for persistent machine storage
VOLUME ["/app/data"]
ENV MACHINES_FILE=/app/data/machines.json

# Default port (overridable via -e PORT=xxxx)
ENV PORT=3000
EXPOSE 3000

# Use host network mode is recommended for WOL broadcast
# docker run --network host wakemaster
CMD ["node", "server.js"]
