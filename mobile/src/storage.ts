import AsyncStorage from '@react-native-async-storage/async-storage';

const CONFIG_KEY = 'config:v1';
const QUEUE_KEY = 'queue:v1';
const MAX_QUEUE = 2000;

export type FilterMode = 'all' | 'selected';

export interface Config {
  serverUrl: string;
  deviceKey: string;
  /** 'all' captures every app; 'selected' only the apps in allowedApps. */
  filterMode: FilterMode;
  /** package name -> display name */
  allowedApps: Record<string, string>;
  /** Play the payment voice for GoPay payment-received notifications. */
  soundEnabled: boolean;
}

export type Connection = Pick<Config, 'serverUrl' | 'deviceKey'>;

const DEFAULT_CONFIG: Config = {
  serverUrl: '',
  deviceKey: '',
  filterMode: 'all',
  allowedApps: {},
  soundEnabled: true,
};

export interface OutgoingNotification {
  key: string;
  package: string;
  app_name: string;
  title: string;
  text: string;
  sub_text: string;
  category: string;
  posted_at: number;
  /** Present when this notification is an incoming (GoPay) payment. */
  payment?: { amount: number | null };
}

export async function loadConfig(): Promise<Config> {
  const raw = await AsyncStorage.getItem(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...(raw ? JSON.parse(raw) : {}) };
}

export async function updateConfig(patch: Partial<Config>): Promise<Config> {
  const next = { ...(await loadConfig()), ...patch };
  next.serverUrl = next.serverUrl.trim().replace(/\/+$/, '');
  next.deviceKey = next.deviceKey.trim();
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}

export async function loadQueue(): Promise<OutgoingNotification[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function saveQueue(q: OutgoingNotification[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
}
