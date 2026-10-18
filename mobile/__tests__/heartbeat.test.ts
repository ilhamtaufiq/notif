/**
 * sendHeartbeat / maybeHeartbeat from src/sync.ts. The module keeps a "last beat" timestamp,
 * so every test loads a fresh copy of it.
 */
const flushPromises = () =>
  new Promise<void>(resolve => setTimeout(resolve, 0));

jest.mock('../src/stats', () => ({ recordOutcome: jest.fn().mockResolvedValue(undefined), recordSent: jest.fn().mockResolvedValue(undefined), loadStats: jest.fn(), resetStats: jest.fn() }));
jest.mock('../src/localNotify', () => ({ showLocalNotification: jest.fn().mockResolvedValue(true) }));
jest.mock('../src/storage', () => ({
  loadConfig: jest.fn(),
  loadQueue: jest.fn(),
  saveQueue: jest.fn(),
}));

type SyncModule = typeof import('../src/sync');

function load(config: { serverUrl: string; deviceKey: string }): SyncModule {
  jest.resetModules();
  const { loadConfig } = require('../src/storage');
  (loadConfig as jest.Mock).mockResolvedValue(config);
  return require('../src/sync');
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

const CONFIG = { serverUrl: 'https://notif.example.com', deviceKey: 'nl_key' };

describe('sendHeartbeat', () => {
  it('posts to /api/heartbeat with the device key', async () => {
    const { sendHeartbeat } = load(CONFIG);
    await expect(sendHeartbeat()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://notif.example.com/api/heartbeat');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'X-Device-Key': 'nl_key' });
  });

  it('is false when the server rejects it or the network fails', async () => {
    const { sendHeartbeat } = load(CONFIG);
    fetchMock.mockResolvedValueOnce({ ok: false });
    await expect(sendHeartbeat()).resolves.toBe(false);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(sendHeartbeat()).resolves.toBe(false);
  });

  it('does nothing until the server URL and key are configured', async () => {
    const { sendHeartbeat } = load({ serverUrl: '', deviceKey: '' });
    await expect(sendHeartbeat()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('maybeHeartbeat', () => {
  it('sends at most one heartbeat every 5 minutes', async () => {
    const { maybeHeartbeat } = load(CONFIG);
    const t0 = 1_800_000_000_000;

    maybeHeartbeat(t0);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    maybeHeartbeat(t0 + 60_000);
    maybeHeartbeat(t0 + 299_000);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    maybeHeartbeat(t0 + 301_000);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never throws when the network is down', async () => {
    const { maybeHeartbeat } = load(CONFIG);
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(() => maybeHeartbeat(1_800_000_000_000)).not.toThrow();
    await flushPromises();
  });
});
