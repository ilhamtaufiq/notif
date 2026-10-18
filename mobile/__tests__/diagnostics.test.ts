/**
 * Every notification the listener sees ends in exactly one bucket, so the diagnostics explain
 * what happened to it: captured, filtered by the app filter, or empty.
 */
import headless from '../src/headless';
import { loadConfig } from '../src/storage';
import { recordOutcome } from '../src/stats';

jest.mock('../src/localNotify', () => ({
  showLocalNotification: jest.fn().mockResolvedValue(true),
}));
jest.mock('../src/storage', () => ({ loadConfig: jest.fn() }));
jest.mock('../src/sound', () => ({
  playPaymentSound: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/sync', () => ({
  enqueue: jest.fn().mockResolvedValue(undefined),
  flush: jest.fn().mockResolvedValue(0),
  maybeHeartbeat: jest.fn(),
}));
jest.mock('../src/stats', () => ({
  recordOutcome: jest.fn().mockResolvedValue(undefined),
  recordSent: jest.fn().mockResolvedValue(undefined),
  loadStats: jest.fn(),
  resetStats: jest.fn(),
}));

const mockConfig = (over: Record<string, unknown> = {}) =>
  (loadConfig as jest.Mock).mockResolvedValue({
    serverUrl: 'http://x',
    deviceKey: 'k',
    filterMode: 'all',
    allowedApps: {},
    soundEnabled: true,
    ...over,
  });

const note = (over: Record<string, string> = {}) =>
  JSON.stringify({
    time: '1700000000000',
    app: 'com.whatsapp',
    title: 'Budi',
    text: 'halo',
    ...over,
  });

const outcomes = () =>
  (recordOutcome as jest.Mock).mock.calls.map(([o, app]) => [o, app]);

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig();
});

describe('diagnostics: what happened to each notification', () => {
  it('counts a captured notification', async () => {
    await headless({ notification: note() });
    expect(outcomes()).toEqual([['captured', 'com.whatsapp']]);
  });

  it('counts a notification dropped by the app filter, with its app', async () => {
    mockConfig({ filterMode: 'selected', allowedApps: {} });
    await headless({ notification: note({ app: 'com.tokopedia.tkpd' }) });
    expect(outcomes()).toEqual([['filtered', 'com.tokopedia.tkpd']]);
  });

  it('counts an empty notification (no title and no text)', async () => {
    await headless({ notification: note({ title: '', text: '' }) });
    expect(outcomes()).toEqual([['empty', 'com.whatsapp']]);
  });

  it('does not count its own notifications or unreadable payloads', async () => {
    await headless({ notification: note({ app: 'com.notiflistener' }) });
    await headless({ notification: 'not json' });
    await headless({});
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it('uses the notification time for the diagnostics timestamp', async () => {
    await headless({ notification: note({ time: '1700000005000' }) });
    expect((recordOutcome as jest.Mock).mock.calls[0][2]).toBe(1700000005000);
  });
});
