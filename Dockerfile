# Gunakan image Node.js versi LTS
FROM node:18-slim

# Install Chromium dan dependencies yang diperlukan
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json terlebih dahulu untuk caching
COPY package.json .

# Install dependencies
RUN npm install --production

# Copy semua file project
COPY . .

# Set environment variables
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Command untuk menjalankan bot
CMD ["node", "server.js"]