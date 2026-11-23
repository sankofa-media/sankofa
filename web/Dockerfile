# The web museum, served by unprivileged nginx on port 8080.
# Build from the repository root so the content and the CLI are in context:
#   docker build -f web/Dockerfile -t sankofa-museum .

FROM --platform=$BUILDPLATFORM golang:1.26.5-alpine AS data
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY api ./api
COPY cmd ./cmd
COPY content ./content
COPY pkg ./pkg
RUN CGO_ENABLED=0 go build -o /out/sankofa ./cmd/sankofa

FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS web
# libvips makes the smaller image copies (scripts/build-media.ts).
RUN apt-get update && apt-get install -y --no-install-recommends libvips-tools webp chromium ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /src
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --no-audit --no-fund
COPY --from=data /out/sankofa /usr/local/bin/sankofa
COPY content ./content
COPY web ./web
ENV SANKOFA_BIN=/usr/local/bin/sankofa
ARG SITE_URL=https://sankofa.black
ENV SITE_URL=$SITE_URL
WORKDIR /src/web
RUN sh scripts/build-data.sh && npx vite build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS museum
LABEL org.opencontainers.image.source="https://github.com/sankofa-media/sankofa" \
      org.opencontainers.image.licenses="Apache-2.0"
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web /src/web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
