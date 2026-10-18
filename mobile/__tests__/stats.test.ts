/**
 * Notification diagnostics: the counters the app shows so a missing notification can be explained
 * (filtered out by the app filter, empty, or captured but not sent).
 */
const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
  },
}));

import { loadStats, recordOutcome, recordSent, resetStats } from '../src/stats';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('stats', () => {
  it('starts at zero with nothing remembered', async () => {
    const s = await loadStats();
    expect(s).toMatchObject({
      captured: 0,
      filtered: 0,
      empty: 0,
      sent: 0,
      lastCaptured: null,
      lastFiltered: null,
      lastEmpty: null,
      lastSent: null,
    });
    expect(s.since).toBeGreaterThan(0);
  });

  it('counts each outcome and remembers the last app and time per outcome', async () => {
    await recordOutcome('captured', 'com.whatsapp', 1000);
    await recordOutcome('filtered', 'com.gojek.gopaymerchant', 2000);
    await recordOutcome('filtered', 'com.tokopedia.tkpd', 3000);
    await recordOutcome('empty', 'com.android.systemui', 4000);

    const s = await loadStats();
    expect([s.captured, s.filtered, s.empty]).toEqual([1, 2, 1]);
    expect(s.lastCaptured).toEqual({ app: 'com.whatsapp', at: 1000 });
    expect(s.lastFiltered).toEqual({ app: 'com.tokopedia.tkpd', at: 3000 });
    expect(s.lastEmpty).toEqual({ app: 'com.android.systemui', at: 4000 });
  });

  it('adds sent counts from flushes and ignores zero', async () => {
    await recordSent(0, 5000);
    expect((await loadStats()).sent).toBe(0);
    await recordSent(3, 6000);
    await recordSent(2, 7000);
    const s = await loadStats();
    expect(s.sent).toBe(5);
    expect(s.lastSent).toBe(7000);
  });

  it('keeps every increment when many notifications arrive at once', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        recordOutcome('captured', `app${i}`, i),
      ),
    );
    expect((await loadStats()).captured).toBe(25);
  });

  it('reset clears the counters and starts a new window', async () => {
    await recordOutcome('captured', 'com.whatsapp', 1000);
    await resetStats(9000);
    const s = await loadStats();
    expect(s.captured).toBe(0);
    expect(s.lastCaptured).toBeNull();
    expect(s.since).toBe(9000);
  });
});
