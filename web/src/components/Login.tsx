import { useState } from 'react';
import { api, setToken } from '../lib/api';

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } = await api.login(username, password);
      setToken(token);
      onLogin();
    } catch {
      setError('Login failed. Check username/password and that the backend is running.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card login" onSubmit={submit}>
      <h1>Notif Listener</h1>
      <p className="muted">Sign in to view your phone's notifications.</p>
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
