FROM node:20-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY functions/package*.json ./
RUN npm ci
COPY functions/ .
RUN rm -rf lib && npm run build && test -f lib/renderJob.js
# Runs as a Cloud Run service (HTTP server on $PORT, not a Cloud Run Job)
CMD ["node", "lib/renderJob.js"]
