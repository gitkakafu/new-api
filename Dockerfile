FROM oven/bun:1@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7 AS builder

WORKDIR /build/web
COPY web/package.json web/bun.lock ./
# why-master: cap bun heap on small VPS builders (e.g. 2G)
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN bun install --frozen-lockfile
COPY ./web ./
COPY ./VERSION /build/VERSION
RUN DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat /build/VERSION) bun run build

# why-master: max-level gzip + zstd siblings for static assets (Caddy precompressed)
FROM python:3.12-slim AS precompress
COPY --from=builder /build/web/dist /dist
COPY packaging/precompress_static.py /precompress_static.py
RUN pip install --no-cache-dir zstandard==0.25.0 \
    && python /precompress_static.py /dist --gzip-level 9 --zstd-level 22

# Optional target: caddy-static — precompressed dist for edge file_server
# MUST stay before the final runtime stage so `docker build -t new-api:local .`
# still produces the app image (last stage wins).
#   docker build --target caddy-static -t new-api-static:local .
FROM alpine:3.21 AS caddy-static
COPY --from=precompress /dist /srv/new-api/default
# Keep classic path as a copy for Caddyfile fallback during transition
COPY --from=precompress /dist /srv/new-api/classic
RUN printf 'new-api-static\n' > /srv/new-api/BUILD_ID \
    && find /srv/new-api -type f | wc -l | tr -d ' ' > /srv/new-api/FILE_COUNT

FROM golang:1.26.1-alpine@sha256:2389ebfa5b7f43eeafbd6be0c3700cc46690ef842ad962f6c5bd6be49ed82039 AS builder2
ENV GO111MODULE=on CGO_ENABLED=0

ARG TARGETOS
ARG TARGETARCH
ENV GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64}
ENV GOEXPERIMENT=greenteagc

WORKDIR /build

ADD go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=precompress /dist ./web/dist
# why-master: limit go build parallelism/memory on small VPS
RUN GOMAXPROCS=1 GOMEMLIMIT=1400MiB go build -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=$(cat VERSION)'" -o new-api

FROM debian:bookworm-slim@sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata libasan8 wget \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

COPY --from=builder2 /build/new-api /
COPY LICENSE NOTICE THIRD-PARTY-LICENSES.md /licenses/
EXPOSE 3000
WORKDIR /data
ENTRYPOINT ["/new-api"]
