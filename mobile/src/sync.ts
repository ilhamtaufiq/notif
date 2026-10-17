import {
  loadConfig,
  loadQueue,
  saveQueue,
  type Connection,
  type OutgoingNotification,
} from './storage';

const BATCH = 100;

// Serialises queue mutations: the headless task can fire several times concurrently.
let chain: Promise<unknown> = Promise.resolve();
const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
};

async function post(
  cfg: Connection,
  batch: OutgoingNotification[],
): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.serverUrl}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Key': cfg.deviceKey,
      },
      body: JSON.stringify({ notifications: batch }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Verifies server reachability and that the device key is accepted. */
export async function testConnection(cfg: Connection): Promise<string | null> {
  try {
    const res = await fetch(`${cfg.serverUrl}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Key': cfg.deviceKey,
      },
      body: JSON.stringify({ notifications: [] }),
    });
    if (res.status === 401) return 'Device key rejected by the server.';
    if (!res.ok) return `Server returned HTTP ${res.status}.`;
    return null;
  } catch (e) {
    return `Cannot reach server: ${(e as Error).message}`;
  }
}

const HEARTBEAT_EVERY_MS = 5 * 60 * 1000;
let lastBeatAt = 0;

/** Tells the server this phone's listener is alive. Resolves to whether the server acknowledged it. */
export async function sendHeartbeat(): Promise<boolean> {
  const cfg = await loadConfig();
  if (!cfg.serverUrl || !cfg.deviceKey) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${cfg.serverUrl}/api/heartbeat`, {
      method: 'POST',
      headers: { 'X-Device-Key': cfg.deviceKey },
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire-and-forget heartbeat, at most once every 5 minutes. Called for every notification the
 * listener sees (even ones it filters out), so the dashboard can tell the listener is still running.
 */
export function maybeHeartbeat(now: number = Date.now()): void {
  if (now - lastBeatAt < HEARTBEAT_EVERY_MS) return;
  lastBeatAt = now;
  sendHeartbeat().catch(() => {});
}

/** Package name the test notification is sent under; the dashboard shows it as its own app. */
export const TEST_PACKAGE = 'com.notiflistener.test';

/**
 * Sends one test notification straight to the server (not via the queue), so the user can check that
 * phone -> server -> dashboard works. Resolves to a message to show the user.
 */
export async function sendTestNotification(
  now: number = Date.now(),
): Promise<{ ok: boolean; message: string }> {
  const cfg = await loadConfig();
  if (!cfg.serverUrl || !cfg.deviceKey) {
    return { ok: false, message: 'Set the server URL and device key first.' };
  }
  const sent = await post(cfg, [
    {
      key: `test-${now}`,
      package: TEST_PACKAGE,
      app_name: 'Notif test',
      title: 'Test notification',
      text: `Sent from the app at ${new Date(now).toLocaleTimeString()}`,
      sub_text: '',
      category: '',
      posted_at: now,
    },
  ]);
  return sent
    ? { ok: true, message: 'Sent. Check the Log tab on the dashboard.' }
    : {
        ok: false,
        message: 'Not sent. Check the server URL, the device key and the connection.',
      };
}

export function enqueue(n: OutgoingNotification): Promise<void> {
  return exclusive(async () => {
    const q = await loadQueue();
    q.push(n);
    await saveQueue(q);
  });
}

/** Sends queued notifications; anything that fails stays queued for the next attempt. */
export function flush(): Promise<number> {
  return exclusive(async () => {
    const cfg = await loadConfig();
    if (!cfg.serverUrl || !cfg.deviceKey) return 0;
    let q = await loadQueue();
    let sent = 0;
    while (q.length > 0) {
      const batch = q.slice(0, BATCH);
      if (!(await post(cfg, batch))) break;
      sent += batch.length;
      q = q.slice(batch.length);
      await saveQueue(q);
    }
    return sent;
  });
}

export async function pendingCount(): Promise<number> {
  return (await loadQueue()).length;
}
