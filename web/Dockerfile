# syntax=docker/dockerfile:1

# ---- build -------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Empty = the browser calls the API on the page's own origin; nginx proxies /api to the backend.
# Set a full URL (https://api.example.com) only if the API is served from a different domain.
ARG PUBLIC_API_URL=""
ENV PUBLIC_API_URL=$PUBLIC_API_URL
RUN npm run build

# ---- runtime -----------------------------------------------------------
FROM nginx:1.27-alpine
# Only these variables are substituted into the template (nginx's own $vars stay untouched).
ENV BACKEND_URL=http://backend:8080 \
    NGINX_ENVSUBST_FILTER=^BACKEND_
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
