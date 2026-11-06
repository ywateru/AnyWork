# Generate artifacts/anywork-source.tar.gz before building (see docs/deployment.md).
FROM node:22-bookworm-slim AS web
WORKDIR /source
COPY artifacts/anywork-source.tar.gz /tmp/source.tar.gz
RUN tar -xzf /tmp/source.tar.gz --strip-components=1 -C /source && npm ci && npm run build
RUN mkdir -p /source/artifacts && mv /tmp/source.tar.gz /source/artifacts/anywork-source.tar.gz

FROM rust:1-bookworm AS rust
WORKDIR /src
COPY --from=web /source/Cargo.toml /source/Cargo.lock ./
COPY --from=web /source/crates crates
RUN cargo build --locked --release

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* && npm install -g @openai/codex && useradd -m -u 10001 agent
WORKDIR /app
COPY --from=rust /src/target/release/anywork /usr/local/bin/anywork
COPY --from=web /source/web/dist ./web/dist
COPY --from=web /source/artifacts ./artifacts
COPY --from=web /source/LICENSE /source/NOTICE ./
COPY --from=web /source/licenses ./licenses
RUN mkdir /data /workspace /app/plugins && chown -R agent:agent /app /data /workspace
USER agent
ENV ANYWORK_BIND=0.0.0.0:3210 ANYWORK_DATA=/data ANYWORK_WORKSPACE=/workspace
EXPOSE 3210
VOLUME ["/data", "/workspace", "/home/agent/.codex"]
ENTRYPOINT ["anywork"]
