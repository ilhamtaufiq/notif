/**
 * The OTA config that scripts/ota.js and app.json rely on. The script itself runs EAS, so these tests check
 * the parts that must stay true for updates to reach phones.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
const eas = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

describe('OTA update configuration', () => {
  it('lets the app fetch updates from the project on EAS', () => {
    expect(app.updates.enabled).toBe(true);
    expect(app.updates.url).toBe(
      `https://u.expo.dev/${app.extra.eas.projectId}`,
    );
    expect(app.updates.checkAutomatically).toBe('ON_LOAD');
  });

  it('ties update compatibility to the app version', () => {
    expect(app.runtimeVersion).toEqual({ policy: 'appVersion' });
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('publishes preview APKs and production builds to matching channels', () => {
    expect(eas.build.preview.channel).toBe('preview');
    expect(eas.build.production.channel).toBe('production');
  });

  it('exposes the OTA commands in package.json', () => {
    expect(pkg.scripts.ota).toBe('node scripts/ota.js preview');
    expect(pkg.scripts['ota:prod']).toBe('node scripts/ota.js production');
  });

  it('keeps the commit guard in the OTA helper', () => {
    const script = readFileSync(join(root, 'scripts', 'ota.js'), 'utf8');
    expect(script).toContain('OTA_ALLOW_DIRTY');
    expect(script).toContain('git status --porcelain');
  });
});
