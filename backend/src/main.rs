use notif_listener_backend::{build_router, init_db, AppState, Config};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .init();

    let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
    let config = Config {
        admin_user: env("ADMIN_USER", "admin"),
        admin_password: env("ADMIN_PASSWORD", "admin"),
        jwt_secret: env("JWT_SECRET", "dev-secret-change-me"),
    };
    if config.admin_password == "admin" || config.jwt_secret == "dev-secret-change-me" {
        tracing::warn!("using default ADMIN_PASSWORD/JWT_SECRET - set them in .env before exposing this server");
    }

    let db = init_db(&env("DATABASE_URL", "sqlite://notif.db?mode=rwc")).await?;
    let app = build_router(AppState::new(db, config));

    let addr = env("BIND_ADDR", "0.0.0.0:8080");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
