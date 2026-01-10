FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV JETSTREAM_URL=wss://jetstream2.us-west.bsky.network/subscribe
ENV WANTED_COLLECTIONS=app.bsky.feed.post
ENV CURSOR_FILE=/data/jetstream.cursor

CMD ["node", "src/index.js"]
