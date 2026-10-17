use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use notif_listener_backend::{build_router, init_db, qris, AppState, Config};
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

    async fn send(&self, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        call(&self.app, method, uri, &[("authorization", &self.bearer)], body).await
    }

    async fn new_invoice(&self, amount: i64) -> Value {
        let (status, inv) = self
            .send("POST", "/api/invoices", Some(json!({"label": "Budi", "amount": amount})))
            .await;
        assert_eq!(status, StatusCode::CREATED, "{inv}");
        inv
    }

    async fn pay(&self, key: &str, amount: i64, posted_at: i64) -> Value {
        let (_, res) = self
            .ingest(vec![gopay(key, "Uang masuk", posted_at, Some(json!({ "amount": amount })))])
            .await;
        res
    }

    async fn invoice(&self, id: &str) -> Value {
        let (_, list) = self.get("/api/invoices?limit=100").await;
        list["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["id"] == id)
            .cloned()
            .expect("invoice in list")
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

fn static_qris() -> String {
    qris::build_with_crc(&[
        ("00", "01"),
        ("01", "11"),
        ("26", "0014ID.CO.QRIS.WWW0215ID1234567890123"),
        ("52", "5812"),
        ("53", "360"),
        ("58", "ID"),
        ("59", "WARUNG CONTOH"),
        ("60", "CIANJUR"),
    ])
}

#[tokio::test]
async fn qris_upload_is_validated_stored_and_removable() {
    let ctx = Ctx::new().await;
    let (_, empty) = ctx.get("/api/settings/qris").await;
    assert_eq!(empty["configured"], false);

    let (status, bad) = ctx.send("PUT", "/api/settings/qris", Some(json!({"payload": "bukan qris"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(bad["error"].is_string());

    let dynamic = qris::build_with_crc(&[("00", "01"), ("01", "12"), ("58", "ID"), ("59", "X"), ("60", "Y")]);
    let (status, err) = ctx.send("PUT", "/api/settings/qris", Some(json!({"payload": dynamic}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(err["error"], "already_dynamic");

    let payload = static_qris();
    let (status, ok) = ctx.send("PUT", "/api/settings/qris", Some(json!({"payload": payload}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ok["merchant_name"], "WARUNG CONTOH");

    let (_, got) = ctx.get("/api/settings/qris").await;
    assert_eq!(got["configured"], true);
    assert_eq!(got["payload"], payload.as_str());
    assert_eq!(got["city"], "CIANJUR");

    let (status, _) = ctx.send("DELETE", "/api/settings/qris", None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, gone) = ctx.get("/api/settings/qris").await;
    assert_eq!(gone["configured"], false);
}

#[tokio::test]
async fn invoice_endpoints_require_auth_and_validate_amount() {
    let ctx = Ctx::new().await;
    for (m, u) in [("GET", "/api/invoices"), ("POST", "/api/invoices"), ("GET", "/api/settings/qris")] {
        let (status, _) = call(&ctx.app, m, u, &[], Some(json!({"amount": 1000}))).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{m} {u}");
    }
    for bad in [0, -5, 2_000_000_000] {
        let (status, err) = ctx.send("POST", "/api/invoices", Some(json!({"amount": bad}))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
        assert_eq!(err["error"], "invalid_amount");
    }
}

#[tokio::test]
async fn open_invoices_with_the_same_amount_get_unique_totals() {
    let ctx = Ctx::new().await;
    let a = ctx.new_invoice(37500).await;
    let b = ctx.new_invoice(37500).await;
    let c = ctx.new_invoice(37500).await;
    assert_eq!((a["total_amount"].as_i64(), a["unique_code"].as_i64()), (Some(37500), Some(0)));
    assert_eq!((b["total_amount"].as_i64(), b["unique_code"].as_i64()), (Some(37501), Some(1)));
    assert_eq!(c["total_amount"], 37502);
    assert_eq!(a["status"], "open");
    assert_eq!(a["amount"], 37500);
    // a cancelled invoice frees its total again
    ctx.send("POST", &format!("/api/invoices/{}/cancel", a["id"].as_str().unwrap()), None).await;
    let d = ctx.new_invoice(37500).await;
    assert_eq!(d["total_amount"], 37500);
}

#[tokio::test]
async fn matching_payment_settles_the_invoice_and_links_it() {
    let ctx = Ctx::new().await;
    let inv = ctx.new_invoice(25000).await;
    let id = inv["id"].as_str().unwrap();

    let res = ctx.pay("p1", 25000, now_ms()).await;
    assert_eq!(res["payments"], 1);
    assert_eq!(res["invoices_paid"], 1);

    let after = ctx.invoice(id).await;
    assert_eq!(after["status"], "paid");
    assert!(after["payment_id"].is_i64());
    assert!(after["paid_at"].is_i64());

    let (_, payments) = ctx.get("/api/payments").await;
    assert_eq!(payments["items"][0]["invoice_label"], "Budi");
    let (_, only_paid) = ctx.get("/api/invoices?status=paid").await;
    assert_eq!(only_paid["total"], 1);
    let (_, only_open) = ctx.get("/api/invoices?status=open").await;
    assert_eq!(only_open["total"], 0);
}

#[tokio::test]
async fn other_amounts_and_resent_notifications_do_not_settle_wrongly() {
    let ctx = Ctx::new().await;
    let inv = ctx.new_invoice(25000).await;
    let id = inv["id"].as_str().unwrap();

    let res = ctx.pay("wrong", 24000, now_ms()).await;
    assert_eq!(res["payments"], 1);
    assert_eq!(res["invoices_paid"], 0);
    assert_eq!(ctx.invoice(id).await["status"], "open");

    // a payment without an amount can never settle anything
    ctx.ingest(vec![gopay("noamt", "Uang masuk", now_ms(), Some(json!({})))]).await;
    assert_eq!(ctx.invoice(id).await["status"], "open");

    // the same notification delivered twice settles only once
    let first = ctx.pay("dup", 25000, now_ms()).await;
    let again = ctx.pay("dup", 25000, now_ms()).await;
    assert_eq!(first["invoices_paid"], 1);
    assert_eq!(again["invoices_paid"], 0);
}

#[tokio::test]
async fn same_amount_invoices_are_settled_by_their_own_totals_in_order() {
    let ctx = Ctx::new().await;
    let a = ctx.new_invoice(50000).await; // total 50000
    let b = ctx.new_invoice(50000).await; // total 50001
    ctx.pay("pb", 50001, now_ms()).await;
    assert_eq!(ctx.invoice(a["id"].as_str().unwrap()).await["status"], "open");
    assert_eq!(ctx.invoice(b["id"].as_str().unwrap()).await["status"], "paid");
    ctx.pay("pa", 50000, now_ms() + 1).await;
    assert_eq!(ctx.invoice(a["id"].as_str().unwrap()).await["status"], "paid");
}

#[tokio::test]
async fn payments_outside_the_invoice_time_window_do_not_settle() {
    let ctx = Ctx::new().await;
    let inv = ctx.new_invoice(10000).await;
    let id = inv["id"].as_str().unwrap();
    // long before the invoice existed
    ctx.pay("early", 10000, now_ms() - 3_600_000).await;
    // well after it expired (default 15 min + 5 min grace)
    ctx.pay("late", 10000, now_ms() + 3_600_000).await;
    assert_eq!(ctx.invoice(id).await["status"], "open");
    // inside the window still works
    let res = ctx.pay("ontime", 10000, now_ms() + 60_000).await;
    assert_eq!(res["invoices_paid"], 1);
}

#[tokio::test]
async fn cancel_and_manual_paid_follow_the_invoice_state() {
    let ctx = Ctx::new().await;
    let inv = ctx.new_invoice(12000).await;
    let id = inv["id"].as_str().unwrap();

    let (status, cancelled) = ctx.send("POST", &format!("/api/invoices/{id}/cancel"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cancelled["status"], "cancelled");
    // a cancelled invoice is not settled by a matching payment
    ctx.pay("c1", 12000, now_ms()).await;
    assert_eq!(ctx.invoice(id).await["status"], "cancelled");
    // can't cancel or pay it again
    let (s1, e1) = ctx.send("POST", &format!("/api/invoices/{id}/cancel"), None).await;
    let (s2, _) = ctx.send("POST", &format!("/api/invoices/{id}/paid"), None).await;
    assert_eq!((s1, s2), (StatusCode::CONFLICT, StatusCode::CONFLICT));
    assert_eq!(e1["error"], "not_open");
    let (s3, _) = ctx.send("POST", "/api/invoices/nope/cancel", None).await;
    assert_eq!(s3, StatusCode::NOT_FOUND);

    let other = ctx.new_invoice(15000).await;
    let oid = other["id"].as_str().unwrap();
    let (status, paid) = ctx.send("POST", &format!("/api/invoices/{oid}/paid"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(paid["status"], "paid");
    assert!(paid["payment_id"].is_null(), "manual payment has no linked payment");
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
