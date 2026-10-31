# 构建 Next.js 前端产物。
FROM node:22-bookworm AS web-build

WORKDIR /app/web

ARG NEXT_PUBLIC_SERVER_URL
ARG NEXT_PUBLIC_CREDIT_STORE_URL
ARG NEXT_PUBLIC_APP_VERSION=dev
ARG NEXT_PUBLIC_ICP_RECORD_NUMBER
ARG NEXT_PUBLIC_GITHUB_URL
ENV NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL}
ENV NEXT_PUBLIC_CREDIT_STORE_URL=${NEXT_PUBLIC_CREDIT_STORE_URL}
ENV NEXT_PUBLIC_ICP_RECORD_NUMBER=${NEXT_PUBLIC_ICP_RECORD_NUMBER}
ENV NEXT_PUBLIC_GITHUB_URL=${NEXT_PUBLIC_GITHUB_URL}

# corepack 下载 pnpm 本体时使用镜像源：它不读取 .npmrc 的 registry，默认的 npmjs.org 在部分网络下会返回 503。
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com/
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml web/.npmrc ./
# 预热 packageManager 声明的 pnpm 版本，下载失败时在此报错，而不是等到 install 阶段。
RUN corepack install
RUN --mount=type=cache,id=novanova-studio-pnpm,target=/app/web/.pnpm-store pnpm install --frozen-lockfile

COPY web/ ./
COPY docs/ /app/docs/
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
COPY --from=web-build /app/docs /app/docs

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=5550
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

EXPOSE 5550
CMD ["node", "server.js"]
