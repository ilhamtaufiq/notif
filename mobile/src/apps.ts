import { getInstalledApps } from 'react-native-get-app-list';

export interface InstalledApp {
  packageName: string;
  appName: string;
}

/** Lists apps installed on the phone (icons from the native module are dropped to save memory). */
export async function listInstalledApps(): Promise<InstalledApp[]> {
  const raw: { packageName: string; appName?: string }[] =
    await getInstalledApps();
  const seen = new Set<string>();
  const apps: InstalledApp[] = [];
  for (const a of raw) {
    if (!a.packageName || seen.has(a.packageName)) continue;
    seen.add(a.packageName);
    apps.push({
      packageName: a.packageName,
      appName: a.appName || a.packageName,
    });
  }
  return apps.sort((a, b) => a.appName.localeCompare(b.appName));
}
