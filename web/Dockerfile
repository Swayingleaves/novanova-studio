# 构建 Next.js 前端产物。
FROM node:22-bookworm AS web-build

WORKDIR /app/web

ARG NEXT_PUBLIC_SERVER_URL
ARG NEXT_PUBLIC_APP_VERSION=dev
ARG NEXT_PUBLIC_ICP_RECORD_NUMBER
ENV NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL}
ENV NEXT_PUBLIC_ICP_RECORD_NUMBER=${NEXT_PUBLIC_ICP_RECORD_NUMBER}

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

COPY . .
RUN printf '%s\n' "${NEXT_PUBLIC_APP_VERSION}" > /app/VERSION \
    && printf '# Changelog\n\n## Unreleased\n' > /app/CHANGELOG.md \
    && pnpm run build

FROM node:22-bookworm AS node-certs

# 运行镜像：只启动 Next.js standalone server。
FROM node:22-bookworm-slim

WORKDIR /app/web

COPY --from=node-certs /etc/ssl/certs /etc/ssl/certs
COPY --from=web-build /app/VERSION /app/VERSION
COPY --from=web-build /app/CHANGELOG.md /app/CHANGELOG.md
COPY --from=web-build /app/web/public ./public
COPY --from=web-build /app/web/.next/standalone ./
COPY --from=web-build /app/web/.next/static ./.next/static

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=5550
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

EXPOSE 5550
CMD ["node", "server.js"]
