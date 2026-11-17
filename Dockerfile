FROM oven/bun:1.4.2-alpine AS base
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY public ./public
COPY src ./src
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV CHROMIUM_NO_SANDBOX=true
EXPOSE 3000
CMD ["bun", "src/index.ts"]
