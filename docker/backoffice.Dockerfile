# syntax=docker/dockerfile:1
# Builds the backoffice from the named build context "src" and serves it with nginx,
# which also proxies /v1 to the backend so the browser stays same-origin.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=src --exclude=node_modules --exclude=dist . .
RUN CI=true pnpm install --frozen-lockfile
RUN pnpm build

FROM nginx:1.29-alpine
COPY spa.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
