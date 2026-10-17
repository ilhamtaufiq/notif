use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use notif_listener_backend::{build_router, init_db, AppState, Config};
use serde_json::{json, Value};
use tower::ServiceExt;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

async fn call(
    app: &Router,
    method: &str,
    uri: &str,
    headers: &[(&str, &str)],
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let req = match body {
        Some(b) => req
            .header("content-type", "application/json")
            .body(Body::from(b.to_string()))
            .unwrap(),
        None => req.body(Body::empty()).unwrap(),
    };
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

struct Ctx {
    app: Router,
    bearer: String,
    device_key: String,
}

impl Ctx {
    async fn new() -> Self {
        let db = init_db("sqlite::memory:").await.unwrap();
        let app = build_router(AppState::new(
            db,
            Config {
                admin_user: "admin".into(),
                admin_password: "pw".into(),
                jwt_secret: "test-secret".into(),
            },
        ));
        let (_, login) = call(
            &app,
            "POST",
            "/api/auth/login",
            &[],
            Some(json!({"username": "admin", "password": "pw"})),
        )
        .await;
        let bearer = format!("Bearer {}", login["token"].as_str().unwrap());
        let (status, dev) = call(
            &app,
            "POST",
            "/api/devices",
            &[("authorization", &bearer)],
            Some(json!({"name": "Test phone"})),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        Ctx { app, bearer, device_key: dev["api_key"].as_str().unwrap().to_string() }
    }

    async fn get(&self, uri: &str) -> (StatusCode, Value) {
        call(&self.app, "GET", uri, &[("authorization", &self.bearer)], None).await
    }

    async fn ingest(&self, notifications: Vec<Value>) -> (StatusCode, Value) {
        call(
            &self.app,
            "POST",
            "/api/ingest",
            &[("x-device-key", &self.device_key)],
            Some(json!({ "notifications": notifications })),
        )
        .await
    }
}

fn gopay(key: &str, text: &str, posted_at: i64, payment: Option<Value>) -> Value {
    let mut n = json!({
        "key": key,
        "package": "com.gojek.gopaymerchant",
        "app_name": "GoPay Merchant",
        "title": "Pembayaran diterima",
        "text": text,
        "posted_at": posted_at,
    });
    if let Some(p) = payment {
        n["payment"] = p;
    }
    n
}

#[tokio::test]
async fn login_rejects_wrong_password() {
    let ctx = Ctx::new().await;
    let (status, _) = call(
        &ctx.app,
        "POST",
        "/api/auth/login",
        &[],
        Some(json!({"username": "admin", "password": "nope"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn dashboard_endpoints_require_jwt() {
    let ctx = Ctx::new().await;
    for uri in ["/api/payments", "/api/payments/summary", "/api/notifications", "/api/stats"] {
        let (status, _) = call(&ctx.app, "GET", uri, &[], None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri}");
    }
}

#[tokio::test]
async fn ingest_requires_valid_device_key() {
    let ctx = Ctx::new().await;
    let body = Some(json!({"notifications": []}));
    let (none, _) = call(&ctx.app, "POST", "/api/ingest", &[], body.clone()).await;
    let (bad, _) = call(&ctx.app, "POST", "/api/ingest", &[("x-device-key", "nl_wrong")], body).await;
    assert_eq!(none, StatusCode::UNAUTHORIZED);
    assert_eq!(bad, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn payment_notifications_become_transactions() {
    let ctx = Ctx::new().await;
    let t = now_ms();
    let (status, res) = ctx
        .ingest(vec![
            gopay("a", "Rp25.000 masuk", t - 2000, Some(json!({"amount": 25000}))),
            gopay("b", "Rp100.000 masuk", t - 1000, Some(json!({"amount": 100000}))),
            json!({"key": "c", "package": "com.whatsapp", "app_name": "WhatsApp",
                   "title": "Budi", "text": "halo", "posted_at": t}),
        ])
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(res["inserted"], 3);
    assert_eq!(res["payments"], 2);

    let (_, list) = ctx.get("/api/payments").await;
    assert_eq!(list["total"], 2);
    assert_eq!(list["sum"], 125000);
    // newest first, joined with notification text
    assert_eq!(list["items"][0]["amount"], 100000);
    assert_eq!(list["items"][0]["app_name"], "GoPay Merchant");
    assert_eq!(list["items"][1]["amount"], 25000);

    // the raw notification log still has everything
    let (_, notifs) = ctx.get("/api/notifications").await;
    assert_eq!(notifs["total"], 3);
}

#[tokio::test]
async fn resending_the_same_notification_does_not_duplicate_payment() {
    let ctx = Ctx::new().await;
    let n = gopay("dup", "Rp50.000 masuk", now_ms(), Some(json!({"amount": 50000})));
    let (_, first) = ctx.ingest(vec![n.clone()]).await;
    let (_, second) = ctx.ingest(vec![n]).await;
    assert_eq!(first["payments"], 1);
    assert_eq!(second["inserted"], 0);
    assert_eq!(second["payments"], 0);
    let (_, list) = ctx.get("/api/payments").await;
    assert_eq!(list["total"], 1);
    assert_eq!(list["sum"], 50000);
}

#[tokio::test]
async fn payment_without_parsable_amount_is_kept_with_null_amount() {
    let ctx = Ctx::new().await;
    ctx.ingest(vec![
        gopay("n1", "Uang masuk", now_ms(), Some(json!({}))),
        gopay("n2", "Pembayaran diterima", now_ms() + 1, Some(json!({"amount": -5}))),
        gopay("n3", "Pembayaran diterima", now_ms() + 2, Some(json!({"amount": 9_000_000_000_000_i64}))),
    ])
    .await;
    let (_, list) = ctx.get("/api/payments").await;
    assert_eq!(list["total"], 3);
    assert_eq!(list["sum"], 0);
    for item in list["items"].as_array().unwrap() {
        assert!(item["amount"].is_null(), "{item}");
    }
}

#[tokio::test]
async fn payments_can_be_filtered_by_amount_and_time() {
    let ctx = Ctx::new().await;
    let t = now_ms();
    ctx.ingest(vec![
        gopay("a", "x", t - 3 * 86_400_000, Some(json!({"amount": 10000}))),
        gopay("b", "x", t - 1000, Some(json!({"amount": 75000}))),
        gopay("c", "x", t - 500, Some(json!({"amount": 200000}))),
    ])
    .await;

    let (_, big) = ctx.get("/api/payments?min=50000").await;
    assert_eq!(big["total"], 2);
    assert_eq!(big["sum"], 275000);

    let (_, mid) = ctx.get("/api/payments?min=50000&max=100000").await;
    assert_eq!(mid["total"], 1);
    assert_eq!(mid["items"][0]["amount"], 75000);

    let from = t - 86_400_000;
    let (_, recent) = ctx.get(&format!("/api/payments?from={from}")).await;
    assert_eq!(recent["total"], 2);
}

#[tokio::test]
async fn log_shows_every_notification_with_the_parser_verdict() {
    let ctx = Ctx::new().await;
    let t = now_ms();
    ctx.ingest(vec![
        gopay("p", "Rp25.000 masuk", t - 3000, Some(json!({"amount": 25000}))),
        gopay("n", "Promo cashback", t - 2000, None), // GoPay, but parser said "not a payment"
        gopay("u", "Uang masuk", t - 1000, Some(json!({}))), // payment, amount unreadable
        json!({"key": "w", "package": "com.whatsapp", "app_name": "WhatsApp",
               "title": "Budi", "text": "halo", "posted_at": t}),
    ])
    .await;

    let (status, all) = ctx.get("/api/notifications").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(all["total"], 4);
    let items = all["items"].as_array().unwrap();
    // newest first: whatsapp, uang masuk, promo, rp25.000
    assert_eq!(items[0]["package"], "com.whatsapp");
    assert_eq!(items[0]["is_payment"], false);
    assert_eq!(items[1]["is_payment"], true);
    assert!(items[1]["payment_amount"].is_null());
    assert_eq!(items[2]["text"], "Promo cashback");
    assert_eq!(items[2]["is_payment"], false);
    assert_eq!(items[3]["is_payment"], true);
    assert_eq!(items[3]["payment_amount"], 25000);

    let (_, yes) = ctx.get("/api/notifications?payment=yes").await;
    assert_eq!(yes["total"], 2);
    let (_, no) = ctx.get("/api/notifications?payment=no").await;
    assert_eq!(no["total"], 2);
    assert!(no["items"].as_array().unwrap().iter().all(|i| i["is_payment"] == false));
}

#[tokio::test]
async fn log_search_covers_text_package_and_filters_combine() {
    let ctx = Ctx::new().await;
    let t = now_ms();
    ctx.ingest(vec![
        gopay("p", "Rp25.000 masuk", t - 2000, Some(json!({"amount": 25000}))),
        gopay("n", "Promo cashback", t - 1000, None),
    ])
    .await;

    let (_, by_pkg) = ctx.get("/api/notifications?q=gopaymerchant").await;
    assert_eq!(by_pkg["total"], 2);
    let (_, by_text) = ctx.get("/api/notifications?q=cashback").await;
    assert_eq!(by_text["total"], 1);
    // search + payment filter + package filter together (columns must not be ambiguous)
    let (status, combo) = ctx
        .get("/api/notifications?q=Rp25&payment=yes&package=com.gojek.gopaymerchant&limit=10&offset=0")
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(combo["total"], 1);
    assert_eq!(combo["items"][0]["payment_amount"], 25000);
    // existing stats endpoint still works with the qualified filters
    let (status, stats) = ctx.get("/api/stats?days=1").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stats["total"], 2);
}

#[tokio::test]
async fn summary_totals_today_and_zero_fills_days() {
    let ctx = Ctx::new().await;
    let t = now_ms();
    ctx.ingest(vec![
        gopay("a", "x", t - 1000, Some(json!({"amount": 30000}))),
        gopay("b", "x", t - 500, Some(json!({"amount": 45000}))),
    ])
    .await;
    let (status, s) = ctx.get("/api/payments/summary?days=7&tz_offset=0").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(s["last7"]["count"], 2);
    assert_eq!(s["last7"]["sum"], 75000);
    assert_eq!(s["last30"]["sum"], 75000);
    let by_day = s["by_day"].as_array().unwrap();
    assert_eq!(by_day.len(), 7);
    let total: i64 = by_day.iter().map(|d| d["sum"].as_i64().unwrap()).sum();
    assert_eq!(total, 75000);
}
