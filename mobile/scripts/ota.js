#!/usr/bin/env node
// Publishes a JavaScript-only update to the phones on a channel (EAS Update).
// Usage: npm run ota -- "pesan perubahan"        -> channel "preview"
//        npm run ota:prod -- "pesan perubahan"   -> channel "production"
//
// Native changes (new packages with native code, permissions, app.json plugins, android/) need a new
// APK build instead: the update is only delivered to builds whose runtimeVersion matches.
const { execSync } = require('child_process');

const channel = process.argv[2] === 'production' ? 'production' : 'preview';
const message = process.argv.slice(3).join(' ').trim();
if (!message) {
  console.error('Pesan update wajib diisi, contoh: npm run ota -- "perbaiki parser GoPay"');
  process.exit(1);
}

// Refuse to publish uncommitted JS to a channel: the message should match a commit people can find later.
const dirty = execSync('git status --porcelain -- .', { cwd: __dirname + '/..' }).toString().trim();
if (dirty && process.env.OTA_ALLOW_DIRTY !== '1') {
  console.error('Ada perubahan belum di-commit di mobile/. Commit dulu, atau jalankan dengan OTA_ALLOW_DIRTY=1.');
  process.exit(1);
}

const cmd = `npx eas-cli update --channel ${channel} --platform android --message ${JSON.stringify(message)}`;
console.log(`> ${cmd}`);
execSync(cmd, { stdio: 'inherit', cwd: __dirname + '/..' });
