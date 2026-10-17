pub mod auth;
pub mod models;
pub mod routes;

use std::str::FromStr;
use std::sync::Arc;

use axum::{
    routing::{delete, get, post},
    Router,
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tokio::sync::broadcast;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

pub struct Config {
    pub admin_user: String,
    pub admin_password: String,
    pub jwt_secret: String,
}

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub config: Arc<Config>,
    pub events: broadcast::Sender<models::Notification>,
    pub payments: broadcast::Sender<models::Payment>,
}

impl AppState {
    pub fn new(db: sqlx::SqlitePool, config: Config) -> Self {
        let (events, _) = broadcast::channel(256);
        let (payments, _) = broadcast::channel(64);
        Self { db, config: Arc::new(config), events, payments }
    }
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS devices (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    key_hash   TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen  INTEGER
);
CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   TEXT NOT NULL,
    notif_key   TEXT NOT NULL,
    package     TEXT NOT NULL,
    app_name    TEXT NOT NULL,
    title       TEXT NOT NULL,
    text        TEXT NOT NULL,
    sub_text    TEXT NOT NULL,
    category    TEXT NOT NULL,
    posted_at   INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    UNIQUE(device_id, notif_key, posted_at)
);
CREATE INDEX IF NOT EXISTS idx_notif_posted ON notifications(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_device ON notifications(device_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_package ON notifications(package);
CREATE TABLE IF NOT EXISTS payments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id INTEGER NOT NULL UNIQUE,
    device_id       TEXT NOT NULL,
    amount          INTEGER,
    paid_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_paid ON payments(paid_at DESC);
"#;

/// Connects (creating the file if needed) and applies the schema. In-memory URLs get a single
/// connection so every query sees the same database.
pub async fn init_db(url: &str) -> anyhow::Result<sqlx::SqlitePool> {
    let in_memory = url.contains(":memory:");
    let mut opts = SqliteConnectOptions::from_str(url)?;
    if !in_memory {
        opts = opts.journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
    }
    let db = SqlitePoolOptions::new()
        .max_connections(if in_memory { 1 } else { 5 })
        .connect_with(opts)
        .await?;
    sqlx::raw_sql(SCHEMA).execute(&db).await?;
    Ok(db)
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/auth/login", post(routes::login))
        .route("/api/devices", get(routes::list_devices).post(routes::create_device))
        .route("/api/devices/:id", delete(routes::delete_device))
        .route("/api/ingest", post(routes::ingest))
        .route("/api/notifications", get(routes::list_notifications))
        .route("/api/payments", get(routes::list_payments))
        .route("/api/payments/summary", get(routes::payment_summary))
        .route("/api/apps", get(routes::list_apps))
        .route("/api/stats", get(routes::stats))
        .route("/api/stream", get(routes::stream))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
