# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26.5-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY api ./api
COPY cmd ./cmd
COPY content ./content
COPY pkg ./pkg
ARG TARGETOS
ARG TARGETARCH
ARG COMMAND=griot
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' -o /out/service ./cmd/${COMMAND}
RUN mkdir -p /out/data && chmod 0770 /out/data

FROM mwader/static-ffmpeg:9.0.2 AS ffmpeg

FROM gcr.io/distroless/static-debian12:nonroot AS service
LABEL org.opencontainers.image.source="https://github.com/sankofa-media/sankofa" \
      org.opencontainers.image.licenses="Apache-2.0"
COPY --from=build /out/service /usr/local/bin/service
COPY --from=build --chown=65532:65532 /out/data /var/lib/griot
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/service"]

FROM service AS angel
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=build --chown=65532:65532 /out/data /var/lib/angel
EXPOSE 8080
