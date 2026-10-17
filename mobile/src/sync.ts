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
