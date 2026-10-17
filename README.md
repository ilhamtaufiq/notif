# Notif Listener

Forward Android notifications to your own server and analyse them on a web dashboard.

```
phone (React Native) --POST /api/ingest--> backend (Rust/axum + SQLite) <--REST + SSE-- web (Astro + React)
```

| Folder     | What                                                                 |
|------------|----------------------------------------------------------------------|
| `backend/` | Rust, axum, SQLite. Ingest, search, stats, live SSE stream, auth     |
| `web/`     | Astro + React dashboard: Overview charts, Notifications, Devices     |
| `mobile/`  | React Native (Android) app using `react-native-android-notification-listener` |

## Run

### 1. Backend
```bash
cd backend
cp .env.example .env   # set ADMIN_PASSWORD and JWT_SECRET
cargo run --release
```
Listens on `0.0.0.0:8080`.

### 2. Web
```bash
cd web
npm install
npm run dev            # http://localhost:4321
```
The API URL defaults to `http://<current-host>:8080`; override with `PUBLIC_API_URL`.

### 3. Pair a phone
1. Sign in on the web, open **Devices**, add a device. Copy the key (shown once).
2. Build the app: `cd mobile && npm install && npm run expo:run` (or build an APK with EAS, see below)
   (needs Android Studio / SDK and a device on the same network).
3. In the app enter `http://<your-pc-lan-ip>:8080` and the device key, tap **Save & test**.
4. Tap **Open notification access settings** and enable Notif Listener.
5. Exclude the app from battery optimisation so Android keeps the listener alive.

Notifications are queued on the phone (AsyncStorage) and retried until the server accepts them.

### Which apps are captured
In the app, section **3. Apps to capture**: choose **All apps**, or **Selected apps** and pick from the
list of apps installed on the phone (search + toggle). The choice is applied on the phone, so
notifications from unselected apps are never sent. (Listing installed apps uses the
`QUERY_ALL_PACKAGES` permission, which Google Play restricts; fine for sideloaded/personal builds.)

### QRIS static payments (main use case)
The app is meant to watch **QRIS static** payments received in **GoPay Merchant**: low volume, varying amounts.
- Phone: a GoPay notification that reads as money in ("uang masuk", "pembayaran diterima", "Rp… masuk", ...)
  is sent with a `payment` flag and the parsed amount (whole rupiah, `null` if unreadable); the voice plays on the phone.
- Backend: stores it in the `payments` table (de-duplicated) and pushes a `payment` SSE event.
- Web: the **Transactions** tab (default) shows totals (today / 7 / 30 days), a per-day chart, filters
  (date range, min/max amount) and the history list. New payments appear live and play the voice in the
  browser; the **Suara pembayaran** switch turns this on/off (remembered per browser; browsers only allow sound
  after you have clicked on the page once). Matching an expected amount is not implemented yet.

### Log tab (inspecting the parser)
The **Log** tab lists *every* notification the phones sent, newest first, each with the parser's verdict:
**Pembayaran · Rp…** (recognised, with the extracted amount or "nominal tidak terbaca"), **bukan pembayaran**,
or an amber **GoPay · tidak dikenali sebagai pembayaran** for GoPay-app notifications the parser let through.
Search covers title, text, sub text, app and package; filter by parser result, app and device; **Raw** shows the
stored JSON; **Salin JSON halaman ini** copies the page so you can paste real samples when tuning
`mobile/src/payment.ts`; **Cek GoPay yang terlewat** jumps straight to GoPay notifications that were not
counted as payments. New notifications appear live.
Only notifications the phone actually sent are logged: ones dropped by the phone's app filter never reach the
server, and the text shown is what the parser saw (big text if present, else the normal text).

### Deploy with Docker / Coolify
`docker-compose.yml` runs two containers: `backend` (Rust, SQLite in the `notif-data` volume at `/data`) and
`web` (static Astro build served by nginx, which also proxies `/api` - including the live SSE stream - to the
backend). One domain serves everything, so there is no CORS or API-URL setup.

**Coolify**
1. New Resource -> Docker Compose, point it at this repository (build pack: Docker Compose).
2. Environment variables: `ADMIN_PASSWORD` and `JWT_SECRET` (required, see `.env.example`; `ADMIN_USER` optional).
3. Under the `web` service set your domain with port 80, e.g. `https://notif.example.com:80`.
4. Deploy. The phone app's server URL is that same domain.

Keep the `notif-data` volume: it holds the database. Back it up if the payment history matters.

**Local test**
```bash
cp .env.example .env     # fill ADMIN_PASSWORD and JWT_SECRET
docker compose up --build   # web is `expose`d only; add `ports: ["8081:80"]` to `web` to browse it locally
```
If the API must live on another domain, build `web` with `PUBLIC_API_URL=https://api.example.com`
(build arg in the compose file).

### Tests
```bash
npm run test:all        # backend (cargo test) + mobile (jest) + web (vitest)
npm run test:backend    # API, auth, ingest de-dup, payments list/filter/summary (in-memory SQLite)
npm run test:mobile     # GoPay detection, amount parsing, headless flow (sound/filter/queue mocked)
npm run test:web        # formatting helpers + Transactions tab (live event, sound switch, filters)
```
Run `npm install` in `web/` and `mobile/` (with `--legacy-peer-deps` for mobile) first.

### GoPay payment voice
When a captured notification comes from an app whose package or name contains `gopay` (GoPay, GoPay
Merchant, ...) and its text looks like money in / payment received, the phone plays
`mobile/assets/sounds/payment_received.mp3`. Matching (`mobile/src/payment.ts`): phrases such as
"uang masuk", "dana/saldo masuk", "pembayaran diterima/berhasil", "menerima pembayaran", "payment received",
or any "Rp <amount>" together with words like pembayaran / uang / diterima / masuk / berhasil.
Toggle it, or press **Test sound**, in the app. To change the voice, replace the mp3 (keep the filename
`payment_received.mp3`; `android/app/src/main/res/raw/` is kept in sync by the Expo plugin on prebuild,
or copy it manually for the CLI build).
Note: "pembayaran berhasil" also matches payments *you* make in a GoPay app.

### Build options for the mobile app
The app uses native modules, so **Expo Go does not work**; use a dev build or an APK.

| Option | Command (in `mobile/`) |
|--------|------------------------|
| Android Studio / CLI | `npm run expo:prebuild` once, then `npx react-native run-android` |
| Expo, local build | `npm run expo:run` (prebuild + install on device/emulator; needs Android SDK) |
| Expo EAS, cloud APK | `npx eas login` then `npm run eas:apk` (no local Android SDK needed) |
| Expo EAS, local APK | `npm run eas:local` |

`app.json` (`expo` key), `eas.json` and the `expo-build-properties` plugin (allows cleartext HTTP for LAN use)
are already configured. The `android/` folder is **generated** from `app.json` by `expo prebuild`
(it is git-ignored; EAS Build runs prebuild by itself). A plain React Native `android/` folder will not build with
Expo SDK 58 (`:expo ... compileSdk` / `expo-module-gradle-plugin not found`), so do not commit one.
`mobile/.npmrc` sets `legacy-peer-deps=true` (needed locally and on EAS, because the notification library
declares a React 18 peer dependency).

EAS APK (profile `preview`), from `mobile/`: `npx eas-cli login`, `npx eas-cli init`, `npm run eas:apk`.
Commit and push first (EAS only uploads git-tracked files).

## API
| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/login` | - |
| GET/POST | `/api/devices`, DELETE `/api/devices/:id` | Bearer JWT |
| POST | `/api/ingest` | `X-Device-Key` |
| GET | `/api/notifications?q&device_id&package&from&to&limit&offset` | Bearer JWT |
| GET | `/api/apps`, `/api/stats?days&device_id&tz_offset` | Bearer JWT |
| GET | `/api/stream` (SSE, `?token=`) | JWT |

## Notes
- Device keys are stored hashed (SHA-256); the dashboard uses a single admin account from `.env`.
- The app allows cleartext HTTP for LAN use. Put the backend behind HTTPS before exposing it to the internet.
- Notifications contain private data (OTPs, messages). Keep the server and DB protected.
