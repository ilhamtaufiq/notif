import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, type Device, type Stats } from '../lib/api';

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

export default function Overview({ devices }: { devices: Device[] }) {
  const [days, setDays] = useState(7);
  const [deviceId, setDeviceId] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .stats({ days, device_id: deviceId || undefined })
      .then((s) => !cancelled && (setStats(s), setError('')))
      .catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [days, deviceId]);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p className="muted">Loading…</p>;

  const peak = stats.by_hour.reduce((best, c, h) => (c > stats.by_hour[best] ? h : best), 0);
  const busiest = stats.top_apps[0];
  const dayData = stats.by_day.map((d) => ({
    label: new Date(d.day_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    count: d.count,
  }));
  const hourData = stats.by_hour.map((count, h) => ({ label: hourLabel(h), count }));

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="seg">
          {RANGES.map((r) => (
            <button
              key={r.days}
              className={days === r.days ? 'active' : ''}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          <option value="">All devices</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid cards">
        <Stat label={`Notifications (${days === 1 ? 'today' : `${days}d`})`} value={stats.total} />
        <Stat label="Today" value={stats.today} />
        <Stat label="Avg / day" value={Math.round(stats.total / stats.days)} />
        <Stat label="Devices" value={stats.devices} />
      </div>

      {stats.total === 0 ? (
        <p className="card muted">
          No notifications in this range yet. Pair a device in the Devices tab and grant notification
          access on the phone.
        </p>
      ) : (
        <>
          <p className="card insight">
            Busiest app: <b>{busiest?.app_name ?? '—'}</b> ({busiest?.count ?? 0}). Peak hour:{' '}
            <b>{hourLabel(peak)}</b> ({stats.by_hour[peak]} notifications).
          </p>

          <div className="grid charts">
            {days > 1 && (
              <Chart title="Per day">
                <BarChart data={dayData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} width={32} />
                  <Tooltip />
                  <Bar dataKey="count" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </Chart>
            )}
            <Chart title="By hour of day">
              <BarChart data={hourData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} interval={3} />
                <YAxis allowDecimals={false} fontSize={12} width={32} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--accent-2)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </Chart>
            <Chart title="Top apps">
              <BarChart data={stats.top_apps} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} fontSize={12} />
                <YAxis type="category" dataKey="app_name" width={110} fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--accent)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </Chart>
          </div>

          {stats.by_category.length > 0 && (
            <div className="card">
              <h3>Categories</h3>
              <div className="chips">
                {stats.by_category.map((c) => (
                  <span className="chip" key={c.category}>
                    {c.category} · {c.count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card stat">
      <div className="muted">{label}</div>
      <div className="big">{value.toLocaleString()}</div>
    </div>
  );
}

function Chart({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
