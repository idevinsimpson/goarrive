FROM node:20-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY functions/package*.json ./
RUN npm ci
COPY functions/ .
RUN npm run build
CMD ["node", "lib/renderJob.js"]
