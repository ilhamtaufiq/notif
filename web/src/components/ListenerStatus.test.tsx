import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ListenerStatus from './ListenerStatus';
import type { Device } from '../lib/api';

const MIN = 60_000;
const NOW = 1_800_000_000_000;

const device = (name: string, ageMin: number | null): Device => ({
  id: name,
  name,
  created_at: 0,
  last_seen: ageMin == null ? null : NOW - ageMin * MIN,
  notif_count: 0,
  server_now: NOW,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const banner = () => screen.getByRole('status');

describe('ListenerStatus', () => {
  it('invites you to add a phone when there is none', () => {
    render(<ListenerStatus devices={[]} loadedAt={NOW} />);
    expect(banner()).toHaveTextContent(/Belum ada perangkat/);
  });

  it('is calm when the listener was heard recently', () => {
    render(<ListenerStatus devices={[device('Pixel', 2)]} loadedAt={NOW} />);
    expect(banner()).toHaveTextContent('Listener aktif · Pixel · 2 menit lalu');
    expect(banner()).toHaveClass('ok');
  });

  it('warns softly when the phone has been quiet for a while', () => {
    render(<ListenerStatus devices={[device('Pixel', 60)]} loadedAt={NOW} />);
    expect(banner()).toHaveClass('warn');
    expect(banner()).toHaveTextContent(/belum terdengar/);
    expect(banner()).toHaveTextContent('1 jam lalu');
  });

  it('raises an alarm when the listener is gone', () => {
    render(<ListenerStatus devices={[device('Pixel', 8 * 60)]} loadedAt={NOW} />);
    expect(banner()).toHaveClass('bad');
    expect(banner()).toHaveTextContent(/Pembayaran mungkin tidak terdeteksi/);
  });

  it('alarms for a phone that never reported', () => {
    render(<ListenerStatus devices={[device('Baru', null)]} loadedAt={NOW} />);
    expect(banner()).toHaveClass('bad');
    expect(banner()).toHaveTextContent('belum pernah');
  });

  it('one live phone among several keeps the banner green and names the freshest', () => {
    render(<ListenerStatus devices={[device('Lama', 500), device('Kasir', 3)]} loadedAt={NOW} />);
    expect(banner()).toHaveClass('ok');
    expect(banner()).toHaveTextContent('Kasir');
  });

  it('turns from green to warning as time passes without a refresh', () => {
    render(<ListenerStatus devices={[device('Pixel', 2)]} loadedAt={NOW} />);
    expect(banner()).toHaveClass('ok');
    act(() => {
      vi.advanceTimersByTime(20 * MIN);
    });
    expect(banner()).toHaveClass('warn');
  });
});
