use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub last_seen: Option<i64>,
    pub notif_count: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Notification {
    pub id: i64,
    pub device_id: String,
    pub package: String,
    pub app_name: String,
    pub title: String,
    pub text: String,
    pub sub_text: String,
    pub category: String,
    pub posted_at: i64,
    pub received_at: i64,
}

/// A notification plus what the phone parser decided about it (log view).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct NotificationLogRow {
    #[sqlx(flatten)]
    #[serde(flatten)]
    pub notification: Notification,
    pub is_payment: bool,
    pub payment_amount: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct IncomingNotification {
    /// Android sbn key; used together with posted_at for de-duplication.
    #[serde(default)]
    pub key: String,
    pub package: String,
    #[serde(default)]
    pub app_name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub sub_text: String,
    #[serde(default)]
    pub category: String,
    pub posted_at: i64,
    /// Set by the phone when the notification looks like an incoming payment.
    #[serde(default)]
    pub payment: Option<IncomingPayment>,
}

#[derive(Debug, Deserialize)]
pub struct IncomingPayment {
    /// Rupiah, if the phone could parse an amount.
    pub amount: Option<i64>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Payment {
    pub id: i64,
    pub notification_id: i64,
    pub device_id: String,
    pub amount: Option<i64>,
    pub paid_at: i64,
    pub app_name: String,
    pub title: String,
    pub text: String,
    /// Label of the invoice this payment settled, if any.
    pub invoice_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Invoice {
    pub id: String,
    pub label: String,
    /// What the seller asked for.
    pub amount: i64,
    /// What the payer must transfer: `amount` plus a small unique code.
    pub total_amount: i64,
    pub unique_code: i64,
    /// open | paid | cancelled | expired (derived from `expires_at`).
    pub status: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub paid_at: Option<i64>,
    /// None on a paid invoice means it was marked paid manually.
    pub payment_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateInvoiceRequest {
    #[serde(default)]
    pub label: String,
    pub amount: i64,
    pub ttl_minutes: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
pub struct InvoiceQuery {
    pub status: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct QrisUpload {
    pub payload: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct PaymentQuery {
    pub device_id: Option<String>,
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub min: Option<i64>,
    pub max: Option<i64>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct IngestRequest {
    pub notifications: Vec<IncomingNotification>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateDeviceRequest {
    pub name: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct NotificationQuery {
    pub device_id: Option<String>,
    pub package: Option<String>,
    pub q: Option<String>,
    pub from: Option<i64>,
    pub to: Option<i64>,
    /// "yes" = only notifications recognised as payments, "no" = only the others.
    pub payment: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct StatsQuery {
    pub device_id: Option<String>,
    /// Look-back window in days (default 7).
    pub days: Option<i64>,
    /// Client UTC offset in minutes (e.g. 420 for UTC+7), for hour/day buckets.
    pub tz_offset: Option<i64>,
}
