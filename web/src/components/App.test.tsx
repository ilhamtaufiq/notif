import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('../lib/api', async (orig) => {
  const real = await orig<typeof import('../lib/api')>();
  return {
    ...real,
    api: {
      devices: vi.fn(() => Promise.resolve([])),
      streamUrl: vi.fn(() => 'http://test/api/stream?token=t'),
    },
  };
});

vi.mock('./Transactions', () => ({ default: () => null }));
vi.mock('./Invoices', () => ({ default: () => null }));
vi.mock('./Overview', () => ({ default: () => null }));
vi.mock('./Devices', () => ({ default: () => null }));
vi.mock('./Login', () => ({ default: () => null }));
vi.mock('./ListenerStatus', () => ({ default: () => null }));
vi.mock('./Notifications', () => ({ default: () => null }));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, (() => void)[]> = {};
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {}
  emit(type: string) {
    for (const fn of this.listeners[type] ?? []) fn();
  }
}

const logButton = () => screen.getByRole('button', { name: /^Log/ });

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  localStorage.setItem('notif-listener-token', 't');
});

describe('Log tab badge', () => {
  it('counts notifications that arrive while another tab is open', () => {
    render(<App />);
    const stream = FakeEventSource.instances[0];
    expect(logButton().textContent).toBe('Log');

    act(() => {
      stream.emit('notification');
      stream.emit('notification');
    });

    expect(logButton().textContent).toBe('Log (2 baru)');
  });

  it('clears when the Log tab is opened and keeps clear while it stays open', () => {
    render(<App />);
    const stream = FakeEventSource.instances[0];
    act(() => stream.emit('notification'));

    fireEvent.click(logButton());
    expect(logButton().textContent).toBe('Log');

    act(() => stream.emit('notification'));
    expect(logButton().textContent).toBe('Log');
  });
});
