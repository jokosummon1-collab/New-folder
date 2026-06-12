# Stage 1: Build the React frontend
FROM node:18 AS client-builder
ENV NODE_ENV=development
WORKDIR /app/client
# Copy only package.json to ignore Windows-specific package-lock.json
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: Serve the application
FROM node:18-bullseye-slim
WORKDIR /app

# Install system dependencies (Python 3, pip, ffmpeg)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf python3 /usr/bin/python

# Install yt-dlp python package
RUN pip3 install --no-cache-dir yt-dlp

# Copy only server package.json to ignore Windows-specific package-lock.json
COPY server/package.json ./server/
RUN cd server && npm install --omit=dev

# Copy server code
COPY server/ ./server/

# Copy built frontend assets
COPY --from=client-builder /app/client/dist ./client/dist

# Create downloads folder and history placeholder
RUN mkdir -p downloads && echo "[]" > history.json

# Set environment variables
ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000

CMD ["node", "server/index.js"]
