FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY data/seed.json ./data/seed.json
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
