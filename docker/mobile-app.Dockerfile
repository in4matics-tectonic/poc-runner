# syntax=docker/dockerfile:1
# Exports the Expo app for web from the named build context "src" and serves it with nginx,
# which also proxies /v1 to the backend so the app can call the API on its own origin.
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=src --exclude=node_modules --exclude=dist --exclude=.expo . .
RUN npm ci --no-audit --no-fund
RUN npx expo export --platform web --output-dir dist

FROM nginx:1.29-alpine
COPY spa.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
