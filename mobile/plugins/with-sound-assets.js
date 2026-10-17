// Expo config plugin: copies assets/sounds/* into android res/raw so `expo prebuild --clean`
// keeps the bundled payment voice available to react-native-sound.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = config =>
  withDangerousMod(config, [
    'android',
    cfg => {
      const src = path.join(cfg.modRequest.projectRoot, 'assets', 'sounds');
      const dest = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'raw',
      );
      if (fs.existsSync(src)) {
        fs.mkdirSync(dest, { recursive: true });
        for (const f of fs.readdirSync(src)) {
          if (/\.(mp3|wav|ogg)$/i.test(f))
            fs.copyFileSync(path.join(src, f), path.join(dest, f));
        }
      }
      return cfg;
    },
  ]);
