const KEY = 'notif-listener-payment-sound';

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable: setting just won't persist */
  }
}

/** Plays the payment voice. Browsers block autoplay until the page has had a click/keypress. */
export function playPaymentSound(): void {
  try {
    void new Audio('/payment_received.mp3').play().catch(() => {});
  } catch {
    /* no audio support */
  }
}
