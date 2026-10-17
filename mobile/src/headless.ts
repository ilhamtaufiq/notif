import { loadConfig } from './storage';
import { isGopayApp, parsePayment } from './payment';
import { playPaymentSound } from './sound';
import { enqueue, flush } from './sync';

// Package of this app; its own foreground notifications would just be noise.
const OWN_PACKAGE = 'com.notiflistener';

const KNOWN_APPS: Record<string, string> = {
  'com.whatsapp': 'WhatsApp',
  'com.whatsapp.w4b': 'WhatsApp Business',
  'org.telegram.messenger': 'Telegram',
  'com.instagram.android': 'Instagram',
  'com.facebook.orca': 'Messenger',
  'com.facebook.katana': 'Facebook',
  'com.twitter.android': 'X',
  'com.google.android.gm': 'Gmail',
  'com.google.android.apps.messaging': 'Messages',
  'com.android.vending': 'Play Store',
  'com.tokopedia.tkpd': 'Tokopedia',
  'com.shopee.id': 'Shopee',
  'com.gojek.app': 'Gojek',
  'com.grabtaxi.passenger': 'Grab',
};

function appLabel(pkg: string): string {
  if (KNOWN_APPS[pkg]) return KNOWN_APPS[pkg];
  const last = pkg.split('.').filter(Boolean).pop() ?? pkg;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

// Android can re-deliver the same notification; only announce each payment once.
const seen: string[] = [];
function markSeen(key: string): boolean {
  if (seen.includes(key)) return false;
  seen.push(key);
  if (seen.length > 100) seen.shift();
  return true;
}

interface RawNotification {
  time?: string;
  app?: string;
  title?: string;
  text?: string;
  subText?: string;
  bigText?: string;
  summaryText?: string;
}

/** Registered as the library's headless JS task: runs even when the UI is closed. */
export default async function headlessNotificationListener({
  notification,
}: {
  notification?: string;
}) {
  if (!notification) return;
  let raw: RawNotification;
  try {
    raw = JSON.parse(notification);
  } catch {
    return;
  }
  const pkg = raw.app ?? '';
  if (!pkg || pkg === OWN_PACKAGE) return;

  const cfg = await loadConfig();
  const allowedName = cfg.allowedApps[pkg];
  if (cfg.filterMode === 'selected' && allowedName === undefined) return;

  const title = raw.title ?? '';
  const text = raw.bigText || raw.text || '';
  if (!title && !text) return; // group summaries etc. carry nothing useful

  const parsed = Number(raw.time);
  const postedAt = Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();

  const label = allowedName || appLabel(pkg);
  const subText = raw.subText || raw.summaryText || '';
  const payment = isGopayApp(pkg, label)
    ? parsePayment(title, text, subText)
    : null;
  const key = `${pkg}|${postedAt}|${title}|${text.length}`;
  if (payment && cfg.soundEnabled && markSeen(key)) {
    playPaymentSound().catch(() => {}); // don't block queueing on playback
  }

  await enqueue({
    key,
    package: pkg,
    app_name: label,
    title,
    text,
    sub_text: subText,
    category: '',
    posted_at: postedAt,
    ...(payment ? { payment } : {}),
  });
  await flush();
}
