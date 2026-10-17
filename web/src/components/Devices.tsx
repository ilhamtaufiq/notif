import { useState } from 'react';
import { API, api, fmtAgo, fmtTime, type Device } from '../lib/api';
import { lastSeenAge, statusFromAge, type DeviceStatus } from '../lib/format';

const STATUS_LABEL: Record<DeviceStatus, string> = {
  active: 'Aktif',
  idle: 'Diam',
  offline: 'Terputus',
  never: 'Belum pernah',
};

const statusOf = (d: Device): DeviceStatus => {
  const now = Date.now();
  return statusFromAge(lastSeenAge(d, now, now));
};

export default function Devices({
  devices,
  onChange,
}: {
  devices: Device[];
  onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; api_key: string } | null>(null);
  const [error, setError] = useState('');

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      const d = await api.createDevice(name.trim());
      setCreated({ name: d.name, api_key: d.api_key });
      setName('');
      setError('');
      onChange();
    } catch (err) {
      setError(String((err as Error).message));
    }
  }

  async function remove(d: Device) {
    if (!confirm(`Delete "${d.name}" and its ${d.notif_count} notifications?`)) return;
    await api.deleteDevice(d.id);
    onChange();
  }

  return (
    <div className="stack">
      <form className="card toolbar" onSubmit={add}>
        <input
          className="grow"
          placeholder="Device name, e.g. Pixel 8"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button disabled={!name.trim()}>Add device</button>
      </form>
      {error && <p className="error">{error}</p>}

      {created && (
        <div className="card notice">
          <h3>Pair "{created.name}"</h3>
          <p>
            Enter these in the phone app. The key is shown <b>only once</b>.
          </p>
          <dl>
            <dt>Server URL</dt>
            <dd>
              <code>{(API || location.origin).replace('localhost', '<your-pc-ip>')}</code>
            </dd>
            <dt>Device key</dt>
            <dd>
              <code>{created.api_key}</code>{' '}
              <button type="button" onClick={() => navigator.clipboard?.writeText(created.api_key)}>
                Copy
              </button>
            </dd>
          </dl>
          <button type="button" onClick={() => setCreated(null)}>
            Done
          </button>
        </div>
      )}

      <div className="card list">
        {devices.length === 0 && <p className="muted pad">No devices yet.</p>}
        {devices.map((d) => (
          <div key={d.id} className="row">
            <div>
              <b>{d.name}</b>{' '}
              <span className={`badge dev-${statusOf(d)}`}>{STATUS_LABEL[statusOf(d)]}</span>
              <div className="muted">
                {d.notif_count.toLocaleString()} notifications · last seen {fmtAgo(d.last_seen)} ·
                added {fmtTime(d.created_at)}
              </div>
            </div>
            <button className="danger" onClick={() => remove(d)}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
