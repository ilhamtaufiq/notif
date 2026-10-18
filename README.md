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
6. Tap **Send test notification** in the app. A "Notif test" entry should appear in the dashboard's **Log** tab within seconds.
   This checks phone -> server -> dashboard without waiting for a real notification.

Notifications are queued on the phone (AsyncStorage) and retried until the server accepts them: on every new notification,
when the app comes to the foreground, and every minute while the app is open. A queue that is still waiting is shown
as "notifications waiting to be sent" in the app.

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

### Why a notification is missing (app diagnostics)
The phone's main screen shows counters since the last reset: **Ditangkap** (captured and queued),
**Dilewati filter** (dropped by "Apps to capture" in Selected mode, with the app name), **Kosong** (no title and no
text), and **Terkirim** (accepted by the server). If a notification is missing from the Log tab, check which bucket it
fell into. "Dilewati filter" means the app is not selected; "Kosong" means the notification had no text to store.

### Listener health (is the phone still listening?)
Payments are only seen while the phone's listener is running, so the dashboard shows a banner on every tab and a
status chip per device (Devices tab):
- **Aktif** - heard from in the last 15 min (green) / **Diam** - quiet up to 3 h (amber, may just be a quiet phone) /
  **Terputus** or **Belum pernah** - longer or never (red: payments may be missed).
- "Heard from" = any notification batch or a **heartbeat** (`POST /api/heartbeat`, at most once per 5 min). The phone
  sends one when the app opens and for *every* notification the listener sees, even ones its app filter drops.
- Limit: without a native background service, a phone that receives no notifications at all and is never opened sends
  no heartbeat, so a very quiet but healthy phone can show amber. Keep a chat app on it, or open the app now and then.
- The mobile app has an **Open battery settings** button. Set the app to "Don't optimise"/"Unrestricted"; on
  Xiaomi/Oppo/Vivo/Samsung also enable Autostart and lock the app in the recents screen.

### Invoices tab (QRIS with a locked amount, settled automatically)
1. **Upload your static QRIS** (a photo/screenshot of the QR on your shop sticker, or paste its text). The browser
   reads it, checks it is a valid *static* QRIS (CRC) and saves it on the server.
2. **Create an invoice** (amount, label, validity 5-60 min). The page shows a QR for the same merchant with that
   amount fixed (static QRIS rewritten as dynamic: initiation 11 -> 12, amount tag 54, new CRC).
3. If another open invoice already needs the same total, a small **unique code** (+Rp 1..99) is added, so each open
   invoice has its own exact total and one transfer can settle only one invoice. The payer pays exactly the total shown.
4. When the phone reports a payment with that exact amount (within the validity window, plus a few minutes of
   slack), the invoice becomes **LUNAS** and the page plays the voice. The payment in **Transactions** shows
   "Tagihan: <label>". Fallbacks: **Tandai lunas manual** and **Batalkan**.

Notes: modifying a static QRIS this way is unofficial - test with a small real payment from the e-wallets your
customers use before relying on it. A payer who ignores the amount and enters something else will not settle the
invoice (the payment is still recorded as a transaction).

### Log tab (inspecting the parser)
The **Log** tab lists *every* notification the phones sent, newest first, each with the parser's verdict:
**Pembayaran · Rp…** (recognised, with the extracted amount or "nominal tidak terbaca"), **bukan pembayaran**,
or an amber **GoPay · tidak dikenali sebagai pembayaran** for GoPay-app notifications the parser let through.
Search covers title, text, sub text, app and package; filter by parser result, app and device; **Raw** shows the
stored JSON; **Salin JSON halaman ini** copies the page so you can paste real samples when tuning
`mobile/src/payment.ts`; **Cek GoPay yang terlewat** jumps straight to GoPay notifications that were not
counted as payments. New notifications appear live while the Log tab is open; while another tab is open the
**Log** tab button shows how many new notifications arrived (e.g. "Log (3 baru)"), and the count clears when you open it.
The Transactions tab only shows payments live.
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

### OTA updates (JavaScript changes without a new APK)
From `mobile/`, after committing your changes:
```bash
npm run ota -- "perbaiki parser GoPay"      # channel preview (the APK built with eas:apk)
npm run ota:prod -- "rilis v1.2"             # channel production
```
Phones pick the update up the next time the app starts (`checkAutomatically: ON_LOAD`), and it applies on the next launch.
- Works for changes in JavaScript/TypeScript and assets that are already in the APK (screens, parser, texts, the sound
  file if its name is unchanged).
- **Does not** work for native changes: new packages with native code, permissions, `app.json` plugins, `android/`.
  Those need a new APK (`npm run eas:apk`). The update is only delivered to builds with the same `runtimeVersion`,
  which is the app version (`version` in `app.json`). Bump `version` when you change native code, so old APKs never get
  an update that expects new native code.
- The script refuses to publish while `mobile/` has uncommitted changes (override with `OTA_ALLOW_DIRTY=1`), so every
  update matches a commit. Only use it for builds you published yourself.
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
