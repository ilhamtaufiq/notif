import headless from '../src/headless';
import { loadConfig } from '../src/storage';
import { enqueue, flush, maybeHeartbeat } from '../src/sync';
import { playPaymentSound } from '../src/sound';

jest.mock('../src/localNotify', () => ({ showLocalNotification: jest.fn().mockResolvedValue(true) }));
jest.mock('../src/storage', () => ({ loadConfig: jest.fn() }));
jest.mock('../src/sync', () => ({
  enqueue: jest.fn().mockResolvedValue(undefined),
  flush: jest.fn().mockResolvedValue(0),
  maybeHeartbeat: jest.fn(),
}));
jest.mock('../src/sound', () => ({
  playPaymentSound: jest.fn().mockResolvedValue(undefined),
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

let clock = 1_700_000_000_000;
const send = (over: Record<string, string>) =>
  headless({
    notification: JSON.stringify({
      time: String(clock++),
      app: 'com.gojek.gopaymerchant',
      title: 'Pembayaran diterima',
      text: 'Rp25.000 dari pelanggan',
      ...over,
    }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig();
});

describe('headless notification handler', () => {
  it('queues a GoPay payment with its amount and plays the voice', async () => {
    await send({});
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((enqueue as jest.Mock).mock.calls[0][0]).toMatchObject({
      package: 'com.gojek.gopaymerchant',
      payment: { amount: 25000 },
    });
    expect(playPaymentSound).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalled();
  });

  it('still queues the payment but stays silent when the sound is turned off', async () => {
    mockConfig({ soundEnabled: false });
    await send({});
    expect((enqueue as jest.Mock).mock.calls[0][0].payment).toEqual({
      amount: 25000,
    });
    expect(playPaymentSound).not.toHaveBeenCalled();
  });

  it('does not treat money words in other apps as a GoPay payment', async () => {
    await send({
      app: 'com.whatsapp',
      title: 'Budi',
      text: 'uang masuk Rp10.000 ya',
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((enqueue as jest.Mock).mock.calls[0][0].payment).toBeUndefined();
    expect(playPaymentSound).not.toHaveBeenCalled();
  });

  it('queues non payment GoPay notifications without the payment flag or sound', async () => {
    await send({ title: 'Promo', text: 'Cashback hingga 50%' });
    expect((enqueue as jest.Mock).mock.calls[0][0].payment).toBeUndefined();
    expect(playPaymentSound).not.toHaveBeenCalled();
  });

  it('announces a re-delivered notification only once', async () => {
    const same = { time: String(clock++) };
    await send(same);
    await send(same);
    expect(playPaymentSound).toHaveBeenCalledTimes(1);
  });

  it('records a payment with a null amount when none is readable', async () => {
    await send({ title: 'Uang masuk', text: 'Buka aplikasi untuk detail' });
    expect((enqueue as jest.Mock).mock.calls[0][0].payment).toEqual({
      amount: null,
    });
  });

  it('in selected mode, ignores apps that were not chosen', async () => {
    mockConfig({
      filterMode: 'selected',
      allowedApps: { 'com.whatsapp': 'WhatsApp' },
    });
    await send({});
    expect(enqueue).not.toHaveBeenCalled();
    expect(playPaymentSound).not.toHaveBeenCalled();
  });

  it('in selected mode, handles a chosen GoPay Merchant app', async () => {
    mockConfig({
      filterMode: 'selected',
      allowedApps: { 'com.gojek.gopaymerchant': 'GoPay Merchant' },
    });
    await send({});
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((enqueue as jest.Mock).mock.calls[0][0].app_name).toBe(
      'GoPay Merchant',
    );
    expect(playPaymentSound).toHaveBeenCalledTimes(1);
  });

  it('reports a heartbeat for notifications it processes', async () => {
    await send({});
    expect(maybeHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('still reports a heartbeat for notifications the app filter drops', async () => {
    mockConfig({
      filterMode: 'selected',
      allowedApps: { 'com.whatsapp': 'WhatsApp' },
    });
    await send({});
    expect(enqueue).not.toHaveBeenCalled();
    expect(maybeHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('does not count its own notifications or garbage as proof of life', async () => {
    await send({ app: 'com.notiflistener' });
    await headless({ notification: 'not json' });
    await headless({});
    expect(maybeHeartbeat).not.toHaveBeenCalled();
  });

  it('ignores its own notifications, empty ones and malformed payloads', async () => {
    await send({ app: 'com.notiflistener' });
    await send({ title: '', text: '' });
    await headless({ notification: 'not json' });
    await headless({});
    expect(enqueue).not.toHaveBeenCalled();
  });
});
