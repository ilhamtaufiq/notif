import Sound from 'react-native-sound';

let playing = false;

/**
 * Plays the bundled payment voice (res/raw/payment_received.mp3).
 * Skips if it is already playing so a burst of notifications does not overlap.
 */
export function playPaymentSound(): Promise<void> {
  if (playing) return Promise.resolve();
  playing = true;
  return new Promise(resolve => {
    const sound = new Sound(
      'payment_received.mp3',
      Sound.MAIN_BUNDLE,
      error => {
        if (error) {
          playing = false;
          resolve();
          return;
        }
        sound.setVolume(1);
        sound.play(() => {
          sound.release();
          playing = false;
          resolve();
        });
      },
    );
  });
}
