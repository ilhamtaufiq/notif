import AsyncStorage from '@react-native-async-storage/async-storage';

const STATS_KEY = 'stats:v1';

/** What happened to one notification the listener saw. */
export type Outcome = 'captured' | 'filtered' | 'empty';

export interface Seen {
  app: string;
  at: number;
}

export interface Stats {
  /** Counters since the last reset. */
  captured: number;
  filtered: number;
  empty: number;
  sent: number;
  since: number;
  lastCaptured: Seen | null;
  lastFiltered: Seen | null;
  lastEmpty: Seen | null;
  lastSent: number | null;
}

const EMPTY: Stats = {
  captured: 0,
  filtered: 0,
  empty: 0,
  sent: 0,
  since: 0,
  lastCaptured: null,
  lastFiltered: null,
  lastEmpty: null,
  lastSent: null,
};

// Headless callbacks can run concurrently; serialise read-modify-write so no increment is lost.
let chain: Promise<unknown> = Promise.resolve();
const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
};

async function read(): Promise<Stats> {
  const raw = await AsyncStorage.getItem(STATS_KEY);
  return raw
    ? { ...EMPTY, ...JSON.parse(raw) }
    : { ...EMPTY, since: Date.now() };
}

async function write(s: Stats): Promise<void> {
  await AsyncStorage.setItem(STATS_KEY, JSON.stringify(s));
}

export function recordOutcome(
  outcome: Outcome,
  app: string,
  at: number = Date.now(),
): Promise<void> {
  return exclusive(async () => {
    const s = await read();
    const seen = { app, at };
    if (outcome === 'captured') {
      s.captured += 1;
      s.lastCaptured = seen;
    } else if (outcome === 'filtered') {
      s.filtered += 1;
      s.lastFiltered = seen;
    } else {
      s.empty += 1;
      s.lastEmpty = seen;
    }
    await write(s);
  });
}

export function recordSent(
  count: number,
  at: number = Date.now(),
): Promise<void> {
  if (count <= 0) return Promise.resolve();
  return exclusive(async () => {
    const s = await read();
    s.sent += count;
    s.lastSent = at;
    await write(s);
  });
}

export function loadStats(): Promise<Stats> {
  return exclusive(read);
}

export function resetStats(now: number = Date.now()): Promise<void> {
  return exclusive(() => write({ ...EMPTY, since: now }));
}
