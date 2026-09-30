# syntax=docker/dockerfile:1
# The mcp repo ships no Dockerfile; the source comes in as the named build context "src".
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY --from=src package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN CI=true pnpm install --frozen-lockfile --prod
COPY --from=src src ./src
ENV NODE_ENV=production MCP_TRANSPORT=http HOST=0.0.0.0 PORT=3001
USER node
EXPOSE 3001
CMD ["node_modules/.bin/tsx", "src/index.ts"]
