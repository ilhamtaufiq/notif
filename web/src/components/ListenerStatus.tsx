import { useEffect, useState } from 'react';
import type { Device } from '../lib/api';
import { bestStatus, formatAge, lastSeenAge } from '../lib/format';

/**
 * One-line health banner for the whole dashboard: payments are only detected while at least one
 * phone's listener is alive, so a silent phone must be visible.
 */
export default function ListenerStatus({ devices, loadedAt }: { devices: Device[]; loadedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const status = bestStatus(devices, loadedAt, now);
  if (status === 'none') {
    return (
      <p className="banner info" role="status">
        Belum ada perangkat. Tambahkan HP di tab Devices agar pembayaran bisa terdeteksi.
      </p>
    );
  }

  const freshest = devices
    .map((d) => ({ d, age: lastSeenAge(d, loadedAt, now) }))
    .filter((x): x is { d: Device; age: number } => x.age != null)
    .sort((a, b) => a.age - b.age)[0];
  const when = freshest ? formatAge(freshest.age) : 'belum pernah';
  const name = freshest?.d.name ?? devices[0].name;

  if (status === 'active') {
    return (
      <p className="banner ok" role="status">
        Listener aktif · {name} · {when}
      </p>
    );
  }
  if (status === 'idle') {
    return (
      <p className="banner warn" role="status">
        Listener belum terdengar · {name} terakhir {when}. Bisa jadi HP memang sepi; kalau ada pembayaran yang
        tidak muncul, cek HP-nya.
      </p>
    );
  }
  return (
    <p className="banner bad" role="status">
      Listener tidak aktif · {name} terakhir {when}. Pembayaran mungkin tidak terdeteksi. Cek internet HP, akses
      notifikasi, dan pengaturan baterai.
    </p>
  );
}
