/**
 * sendTestNotification from src/sync.ts: posts one test notification straight to /api/ingest.
 */
export {};

jest.mock('../src/stats', () => ({ recordOutcome: jest.fn().mockResolvedValue(undefined), recordSent: jest.fn().mockResolvedValue(undefined), loadStats: jest.fn(), resetStats: jest.fn() }));
jest.mock('../src/localNotify', () => ({ showLocalNotification: jest.fn().mockResolvedValue(true) }));
jest.mock('../src/storage', () => ({
  loadConfig: jest.fn(),
  loadQueue: jest.fn(),
  saveQueue: jest.fn(),
}));

const fetchMock = jest.fn();

beforeEach(() => {
  jest.resetModules();
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

function load(config: { serverUrl: string; deviceKey: string }) {
  const { loadConfig } = require('../src/storage');
  (loadConfig as jest.Mock).mockResolvedValue(config);
  return require('../src/sync') as typeof import('../src/sync');
}

const CONFIG = { serverUrl: 'https://notif.example.com', deviceKey: 'nl_key' };

describe('sendTestNotification', () => {
  it('posts one test notification to /api/ingest with the device key', async () => {
    const { sendTestNotification, TEST_PACKAGE } = load(CONFIG);
    fetchMock.mockResolvedValue({ ok: true });

    const result = await sendTestNotification(1_760_000_000_000);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://notif.example.com/api/ingest');
    expect(init.headers['X-Device-Key']).toBe('nl_key');
    const body = JSON.parse(init.body);
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0]).toMatchObject({
      package: TEST_PACKAGE,
      app_name: 'Notif test',
      title: 'Test notification',
      posted_at: 1_760_000_000_000,
    });
    expect(body.notifications[0].payment).toBeUndefined();
  });

  it('reports failure when the server rejects or cannot be reached', async () => {
    const { sendTestNotification } = load(CONFIG);
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    expect((await sendTestNotification()).ok).toBe(false);

    fetchMock.mockRejectedValue(new Error('network down'));
    const result = await sendTestNotification();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Tidak terkirim ke server/);
  });

  it('asks for the connection settings when they are missing', async () => {
    const { sendTestNotification } = load({ serverUrl: '', deviceKey: '' });

    const result = await sendTestNotification();

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
