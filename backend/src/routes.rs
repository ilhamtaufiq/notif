use std::convert::Infallible;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use rand::{distributions::Alphanumeric, Rng};
use serde_json::{json, Value};
use sqlx::{QueryBuilder, Sqlite};
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};

use crate::{
    auth::{hash_key, issue_token, AuthUser, DeviceAuth},
    models::*,
    AppState,
};

type ApiResult<T> = Result<T, StatusCode>;

fn internal<E: std::fmt::Display>(e: E) -> StatusCode {
    tracing::error!("{e}");
    StatusCode::INTERNAL_SERVER_ERROR
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

// ---------- auth & devices ----------

pub async fn login(
    State(st): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> ApiResult<Json<Value>> {
    if req.username != st.config.admin_user || req.password != st.config.admin_password {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let token = issue_token(&st.config.jwt_secret, &req.username).map_err(internal)?;
    Ok(Json(json!({ "token": token })))
}

pub async fn list_devices(_: AuthUser, State(st): State<AppState>) -> ApiResult<Json<Vec<Device>>> {
    let rows = sqlx::query_as::<_, Device>(
        "SELECT d.id, d.name, d.created_at, d.last_seen,
                (SELECT COUNT(*) FROM notifications n WHERE n.device_id = d.id) AS notif_count
         FROM devices d ORDER BY d.created_at DESC",
    )
    .fetch_all(&st.db)
    .await
    .map_err(internal)?;
    Ok(Json(rows))
}

pub async fn create_device(
    _: AuthUser,
    State(st): State<AppState>,
    Json(req): Json<CreateDeviceRequest>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let name = req.name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let id = uuid::Uuid::new_v4().to_string();
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    let api_key = format!("nl_{suffix}");
    sqlx::query("INSERT INTO devices (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(name)
        .bind(hash_key(&api_key))
        .bind(now_ms())
        .execute(&st.db)
        .await
        .map_err(internal)?;
    // The plain key is only ever returned here; only its hash is stored.
    Ok((
        StatusCode::CREATED,
        Json(json!({ "id": id, "name": name, "api_key": api_key })),
    ))
}

pub async fn delete_device(
    _: AuthUser,
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let mut tx = st.db.begin().await.map_err(internal)?;
    sqlx::query("DELETE FROM notifications WHERE device_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let res = sqlx::query("DELETE FROM devices WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    if res.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------- ingest (mobile -> server) ----------

pub async fn ingest(
    DeviceAuth(device_id): DeviceAuth,
    State(st): State<AppState>,
    Json(req): Json<IngestRequest>,
) -> ApiResult<Json<Value>> {
    if req.notifications.len() > 500 {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let received_at = now_ms();
    let mut inserted = 0;
    let mut tx = st.db.begin().await.map_err(internal)?;
    let mut fresh = Vec::new();
    let mut fresh_payments: Vec<i64> = Vec::new();

    for n in req.notifications.iter().filter(|n| !n.package.is_empty()) {
        let row = sqlx::query_as::<_, Notification>(
            "INSERT INTO notifications
               (device_id, notif_key, package, app_name, title, text, sub_text, category, posted_at, received_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(device_id, notif_key, posted_at) DO NOTHING
             RETURNING id, device_id, package, app_name, title, text, sub_text, category, posted_at, received_at",
        )
        .bind(&device_id)
        .bind(clip(&n.key, 300))
        .bind(clip(&n.package, 200))
        .bind(clip(if n.app_name.is_empty() { &n.package } else { &n.app_name }, 200))
        .bind(clip(&n.title, 500))
        .bind(clip(&n.text, 4000))
        .bind(clip(&n.sub_text, 500))
        .bind(clip(&n.category, 100))
        .bind(n.posted_at)
        .bind(received_at)
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal)?;
        if let Some(row) = row {
            inserted += 1;
            if let Some(p) = &n.payment {
                let amount = p.amount.filter(|a| (0..1_000_000_000_000).contains(a));
                let pid: Option<(i64,)> = sqlx::query_as(
                    "INSERT INTO payments (notification_id, device_id, amount, paid_at)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(notification_id) DO NOTHING RETURNING id",
                )
                .bind(row.id)
                .bind(&device_id)
                .bind(amount)
                .bind(row.posted_at)
                .fetch_optional(&mut *tx)
                .await
                .map_err(internal)?;
                if let Some((pid,)) = pid {
                    fresh_payments.push(pid);
                }
            }
            fresh.push(row);
        }
    }
    sqlx::query("UPDATE devices SET last_seen = ? WHERE id = ?")
        .bind(received_at)
        .bind(&device_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;

    for row in fresh {
        let _ = st.events.send(row); // no subscribers is fine
    }
    for pid in &fresh_payments {
        let row = sqlx::query_as::<_, Payment>(&format!("{PAYMENT_SELECT} WHERE p.id = ?"))
            .bind(pid)
            .fetch_one(&st.db)
            .await
            .map_err(internal)?;
        let _ = st.payments.send(row);
    }
    Ok(Json(json!({ "inserted": inserted, "payments": fresh_payments.len() })))
}

// ---------- queries (dashboard) ----------

fn push_filters<'a>(qb: &mut QueryBuilder<'a, Sqlite>, q: &'a NotificationQuery) {
    // Columns are table-qualified so the same filters work with and without the payments join.
    qb.push(" WHERE 1=1");
    if let Some(d) = q.device_id.as_deref().filter(|s| !s.is_empty()) {
        qb.push(" AND notifications.device_id = ").push_bind(d);
    }
    if let Some(p) = q.package.as_deref().filter(|s| !s.is_empty()) {
        qb.push(" AND notifications.package = ").push_bind(p);
    }
    if let Some(from) = q.from {
        qb.push(" AND notifications.posted_at >= ").push_bind(from);
    }
    if let Some(to) = q.to {
        qb.push(" AND notifications.posted_at <= ").push_bind(to);
    }
    if let Some(text) = q.q.as_deref().filter(|s| !s.is_empty()) {
        let like = format!("%{text}%");
        qb.push(" AND (notifications.title LIKE ").push_bind(like.clone());
        qb.push(" OR notifications.text LIKE ").push_bind(like.clone());
        qb.push(" OR notifications.sub_text LIKE ").push_bind(like.clone());
        qb.push(" OR notifications.package LIKE ").push_bind(like.clone());
        qb.push(" OR notifications.app_name LIKE ").push_bind(like).push(")");
    }
    // Only valid on queries that LEFT JOIN payments (the log).
    match q.payment.as_deref() {
        Some("yes") => {
            qb.push(" AND payments.id IS NOT NULL");
        }
        Some("no") => {
            qb.push(" AND payments.id IS NULL");
        }
        _ => {}
    }
}

const LOG_JOIN: &str = " LEFT JOIN payments ON payments.notification_id = notifications.id";

pub async fn list_notifications(
    _: AuthUser,
    State(st): State<AppState>,
    Query(q): Query<NotificationQuery>,
) -> ApiResult<Json<Value>> {
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);

    let mut count = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM notifications");
    count.push(LOG_JOIN);
    push_filters(&mut count, &q);
    let (total,): (i64,) = count
        .build_query_as()
        .fetch_one(&st.db)
        .await
        .map_err(internal)?;

    // Each row carries the phone parser's verdict: a matching payments row means it was
    // recognised as an incoming payment (with the amount it extracted, if any).
    let mut qb = QueryBuilder::<Sqlite>::new(
        "SELECT notifications.id, notifications.device_id, notifications.package,
                notifications.app_name, notifications.title, notifications.text,
                notifications.sub_text, notifications.category, notifications.posted_at,
                notifications.received_at,
                (payments.id IS NOT NULL) AS is_payment, payments.amount AS payment_amount
         FROM notifications",
    );
    qb.push(LOG_JOIN);
    push_filters(&mut qb, &q);
    qb.push(" ORDER BY notifications.posted_at DESC, notifications.id DESC LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);
    let items: Vec<NotificationLogRow> = qb
        .build_query_as()
        .fetch_all(&st.db)
        .await
        .map_err(internal)?;

    Ok(Json(json!({ "items": items, "total": total })))
}

pub async fn list_apps(_: AuthUser, State(st): State<AppState>) -> ApiResult<Json<Value>> {
    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT package, MAX(app_name), COUNT(*) FROM notifications GROUP BY package ORDER BY COUNT(*) DESC",
    )
    .fetch_all(&st.db)
    .await
    .map_err(internal)?;
    let apps: Vec<Value> = rows
        .into_iter()
        .map(|(package, app_name, count)| json!({ "package": package, "app_name": app_name, "count": count }))
        .collect();
    Ok(Json(json!(apps)))
}

pub async fn stats(
    _: AuthUser,
    State(st): State<AppState>,
    Query(q): Query<StatsQuery>,
) -> ApiResult<Json<Value>> {
    let days = q.days.unwrap_or(7).clamp(1, 365);
    let off_min = q.tz_offset.unwrap_or(0).clamp(-840, 840);
    let off_ms = off_min * 60_000;
    let now = now_ms();
    let day_ms = 86_400_000;
    let today_start = ((now + off_ms) / day_ms) * day_ms - off_ms;
    let since = today_start - (days - 1) * day_ms;

    let range = NotificationQuery {
        device_id: q.device_id.clone(),
        from: Some(since),
        ..Default::default()
    };

    let mut total_qb = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM notifications");
    push_filters(&mut total_qb, &range);
    let (total,): (i64,) = total_qb.build_query_as().fetch_one(&st.db).await.map_err(internal)?;

    let today_range = NotificationQuery {
        device_id: q.device_id.clone(),
        from: Some(today_start),
        ..Default::default()
    };
    let mut today_qb = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM notifications");
    push_filters(&mut today_qb, &today_range);
    let (today,): (i64,) = today_qb.build_query_as().fetch_one(&st.db).await.map_err(internal)?;

    let (devices,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM devices")
        .fetch_one(&st.db)
        .await
        .map_err(internal)?;

    // top apps
    let mut qb = QueryBuilder::<Sqlite>::new("SELECT package, MAX(app_name), COUNT(*) FROM notifications");
    push_filters(&mut qb, &range);
    qb.push(" GROUP BY package ORDER BY COUNT(*) DESC LIMIT 10");
    let top_apps: Vec<(String, String, i64)> = qb.build_query_as().fetch_all(&st.db).await.map_err(internal)?;

    // by hour of day (client-local)
    let mut qb = QueryBuilder::<Sqlite>::new("SELECT CAST(strftime('%H', (posted_at + ");
    qb.push_bind(off_ms)
        .push(") / 1000, 'unixepoch') AS INTEGER) AS h, COUNT(*) FROM notifications");
    push_filters(&mut qb, &range);
    qb.push(" GROUP BY h");
    let hour_rows: Vec<(i64, i64)> = qb.build_query_as().fetch_all(&st.db).await.map_err(internal)?;
    let mut by_hour = vec![0i64; 24];
    for (h, c) in hour_rows {
        if (0..24).contains(&h) {
            by_hour[h as usize] = c;
        }
    }

    // by day (client-local), zero-filled
    let mut qb = QueryBuilder::<Sqlite>::new("SELECT (posted_at + ");
    qb.push_bind(off_ms)
        .push(") / ")
        .push_bind(day_ms)
        .push(" AS d, COUNT(*) FROM notifications");
    push_filters(&mut qb, &range);
    qb.push(" GROUP BY d");
    let day_rows: Vec<(i64, i64)> = qb.build_query_as().fetch_all(&st.db).await.map_err(internal)?;
    let by_day: Vec<Value> = (0..days)
        .map(|i| {
            let day_idx = (since + off_ms) / day_ms + i;
            let count = day_rows.iter().find(|(d, _)| *d == day_idx).map(|(_, c)| *c).unwrap_or(0);
            json!({ "day_start": day_idx * day_ms - off_ms, "count": count })
        })
        .collect();

    // by category
    let mut qb = QueryBuilder::<Sqlite>::new("SELECT category, COUNT(*) FROM notifications");
    push_filters(&mut qb, &range);
    qb.push(" AND category != '' GROUP BY category ORDER BY COUNT(*) DESC LIMIT 8");
    let by_category: Vec<(String, i64)> = qb.build_query_as().fetch_all(&st.db).await.map_err(internal)?;

    Ok(Json(json!({
        "days": days,
        "total": total,
        "today": today,
        "devices": devices,
        "top_apps": top_apps.into_iter()
            .map(|(package, app_name, count)| json!({ "package": package, "app_name": app_name, "count": count }))
            .collect::<Vec<_>>(),
        "by_hour": by_hour,
        "by_day": by_day,
        "by_category": by_category.into_iter()
            .map(|(category, count)| json!({ "category": category, "count": count }))
            .collect::<Vec<_>>(),
    })))
}

// ---------- live stream ----------

pub async fn stream(
    _: AuthUser,
    State(st): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let notifications = BroadcastStream::new(st.events.subscribe()).filter_map(|r| {
        r.ok()
            .and_then(|n| Event::default().event("notification").json_data(n).ok())
            .map(Ok::<Event, Infallible>)
    });
    let payments = BroadcastStream::new(st.payments.subscribe()).filter_map(|r| {
        r.ok()
            .and_then(|p| Event::default().event("payment").json_data(p).ok())
            .map(Ok::<Event, Infallible>)
    });
    Sse::new(notifications.merge(payments)).keep_alive(KeepAlive::default())
}

// ---------- payments ----------

const PAYMENT_SELECT: &str = "SELECT p.id, p.notification_id, p.device_id, p.amount, p.paid_at,
        n.app_name, n.title, n.text
     FROM payments p JOIN notifications n ON n.id = p.notification_id";

fn push_payment_filters<'a>(qb: &mut QueryBuilder<'a, Sqlite>, q: &'a PaymentQuery) {
    qb.push(" WHERE 1=1");
    if let Some(d) = q.device_id.as_deref().filter(|s| !s.is_empty()) {
        qb.push(" AND p.device_id = ").push_bind(d);
    }
    if let Some(v) = q.from {
        qb.push(" AND p.paid_at >= ").push_bind(v);
    }
    if let Some(v) = q.to {
        qb.push(" AND p.paid_at <= ").push_bind(v);
    }
    if let Some(v) = q.min {
        qb.push(" AND p.amount >= ").push_bind(v);
    }
    if let Some(v) = q.max {
        qb.push(" AND p.amount <= ").push_bind(v);
    }
}

pub async fn list_payments(
    _: AuthUser,
    State(st): State<AppState>,
    Query(q): Query<PaymentQuery>,
) -> ApiResult<Json<Value>> {
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);

    let mut agg =
        QueryBuilder::<Sqlite>::new("SELECT COUNT(*), COALESCE(SUM(p.amount), 0) FROM payments p");
    push_payment_filters(&mut agg, &q);
    let (total, sum): (i64, i64) = agg.build_query_as().fetch_one(&st.db).await.map_err(internal)?;

    let mut qb = QueryBuilder::<Sqlite>::new(PAYMENT_SELECT);
    push_payment_filters(&mut qb, &q);
    qb.push(" ORDER BY p.paid_at DESC, p.id DESC LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);
    let items: Vec<Payment> = qb.build_query_as().fetch_all(&st.db).await.map_err(internal)?;

    Ok(Json(json!({ "items": items, "total": total, "sum": sum })))
}

async fn window_totals(
    st: &AppState,
    device_id: &Option<String>,
    since: i64,
) -> Result<(i64, i64), StatusCode> {
    let pq = PaymentQuery {
        device_id: device_id.clone(),
        from: Some(since),
        ..Default::default()
    };
    let mut qb =
        QueryBuilder::<Sqlite>::new("SELECT COUNT(*), COALESCE(SUM(p.amount), 0) FROM payments p");
    push_payment_filters(&mut qb, &pq);
    qb.build_query_as().fetch_one(&st.db).await.map_err(internal)
}

pub async fn payment_summary(
    _: AuthUser,
    State(st): State<AppState>,
    Query(q): Query<StatsQuery>,
) -> ApiResult<Json<Value>> {
    let days = q.days.unwrap_or(14).clamp(1, 365);
    let off_ms = q.tz_offset.unwrap_or(0).clamp(-840, 840) * 60_000;
    let day_ms: i64 = 86_400_000;
    let today_start = ((now_ms() + off_ms) / day_ms) * day_ms - off_ms;

    let (today_n, today_sum) = window_totals(&st, &q.device_id, today_start).await?;
    let (week_n, week_sum) = window_totals(&st, &q.device_id, today_start - 6 * day_ms).await?;
    let (month_n, month_sum) = window_totals(&st, &q.device_id, today_start - 29 * day_ms).await?;

    let since = today_start - (days - 1) * day_ms;
    let pq = PaymentQuery {
        device_id: q.device_id.clone(),
        from: Some(since),
        ..Default::default()
    };
    let mut qb = QueryBuilder::<Sqlite>::new("SELECT (p.paid_at + ");
    qb.push_bind(off_ms)
        .push(") / ")
        .push_bind(day_ms)
        .push(" AS d, COUNT(*), COALESCE(SUM(p.amount), 0) FROM payments p");
    push_payment_filters(&mut qb, &pq);
    qb.push(" GROUP BY d");
    let rows: Vec<(i64, i64, i64)> = qb.build_query_as().fetch_all(&st.db).await.map_err(internal)?;
    let by_day: Vec<Value> = (0..days)
        .map(|i| {
            let idx = (since + off_ms) / day_ms + i;
            let (count, sum) = rows
                .iter()
                .find(|(d, _, _)| *d == idx)
                .map(|(_, c, s)| (*c, *s))
                .unwrap_or((0, 0));
            json!({ "day_start": idx * day_ms - off_ms, "count": count, "sum": sum })
        })
        .collect();

    Ok(Json(json!({
        "today": { "count": today_n, "sum": today_sum },
        "last7": { "count": week_n, "sum": week_sum },
        "last30": { "count": month_n, "sum": month_sum },
        "by_day": by_day,
    })))
}
