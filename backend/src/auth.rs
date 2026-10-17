use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts},
    http::{header, request::Parts, StatusCode},
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

pub fn issue_token(secret: &str, user: &str) -> anyhow::Result<String> {
    let exp = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs()
        + 60 * 60 * 24 * 7) as usize;
    Ok(encode(
        &Header::default(),
        &Claims { sub: user.to_string(), exp },
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

pub fn hash_key(key: &str) -> String {
    hex::encode(Sha256::digest(key.as_bytes()))
}

/// Authenticated dashboard user. Accepts `Authorization: Bearer <jwt>` or `?token=<jwt>`
/// (the latter because browsers' EventSource cannot set headers).
pub struct AuthUser;

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let state = AppState::from_ref(state);
        let from_header = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::to_owned);
        let from_query = parts.uri.query().and_then(|q| {
            q.split('&')
                .find_map(|kv| kv.strip_prefix("token=").map(str::to_owned))
        });
        let token = from_header.or(from_query).ok_or(StatusCode::UNAUTHORIZED)?;
        decode::<Claims>(
            &token,
            &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
        Ok(AuthUser)
    }
}

/// Mobile device authenticated by `X-Device-Key`. Holds the device id.
pub struct DeviceAuth(pub String);

#[async_trait]
impl<S> FromRequestParts<S> for DeviceAuth
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let state = AppState::from_ref(state);
        let key = parts
            .headers
            .get("x-device-key")
            .and_then(|v| v.to_str().ok())
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let id: Option<(String,)> = sqlx::query_as("SELECT id FROM devices WHERE key_hash = ?")
            .bind(hash_key(key))
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        id.map(|(id,)| DeviceAuth(id)).ok_or(StatusCode::UNAUTHORIZED)
    }
}
