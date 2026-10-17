# syntax=docker/dockerfile:1

# ---- build -------------------------------------------------------------
FROM rust:1-bookworm AS build
WORKDIR /app

# Compile dependencies first so source-only changes rebuild quickly.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && touch src/lib.rs \
    && cargo build --release \
    && rm -rf src

COPY src ./src
RUN touch src/main.rs src/lib.rs && cargo build --release --bin notif-listener-backend

# ---- runtime -----------------------------------------------------------
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /data app \
    && mkdir /data && chown app /data

COPY --from=build /app/target/release/notif-listener-backend /usr/local/bin/notif-listener-backend

ENV BIND_ADDR=0.0.0.0:8080 \
    DATABASE_URL="sqlite:///data/notif.db?mode=rwc" \
    RUST_LOG=info

USER app
# SQLite database lives here: mount a persistent volume on it.
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

CMD ["notif-listener-backend"]
