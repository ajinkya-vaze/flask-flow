// Light haptic tap.
// Android: Vibration API. iPhone (iOS 18+ Safari): toggling a hidden <input switch>
// produces a system haptic. It only works from inside a tap handler.
let enabled = true;

export function setHapticsEnabled(v) {
  enabled = v;
}

export function haptic() {
  if (!enabled) return;
  try {
    if (navigator.vibrate) {
      navigator.vibrate(12);
      return;
    }
    const label = document.createElement('label');
    label.ariaHidden = 'true';
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    document.head.removeChild(label);
  } catch {
    /* no haptics available */
  }
}
