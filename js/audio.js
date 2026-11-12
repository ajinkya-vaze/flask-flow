// Tiny synthesized sound effects (no audio files needed).
let ctx = null;
let enabled = true;

export function setSoundEnabled(v) {
  enabled = v;
}

/** Must be called from a user gesture once, iOS keeps audio locked until then. */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone({ freq, to, dur = 0.12, type = 'sine', vol = 0.15, delay = 0 }) {
  if (!enabled || !ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.03);
}

export const sfx = {
  select: () => tone({ freq: 540, to: 720, dur: 0.06, vol: 0.06 }),
  invalid: () => tone({ freq: 190, to: 120, dur: 0.14, type: 'triangle', vol: 0.1 }),
  pour(n = 1) {
    const count = 2 + n;
    for (let k = 0; k < count; k++) {
      tone({ freq: 240 + Math.random() * 90, to: 480 + Math.random() * 160, dur: 0.075, vol: 0.09, delay: k * 0.085 });
    }
  },
  complete() {
    tone({ freq: 880, dur: 0.28, type: 'triangle', vol: 0.12 });
    tone({ freq: 1320, dur: 0.34, type: 'triangle', vol: 0.1, delay: 0.08 });
  },
  thaw: () => tone({ freq: 1400, to: 600, dur: 0.35, type: 'sine', vol: 0.07 }),
  undo: () => tone({ freq: 620, to: 420, dur: 0.08, vol: 0.06 }),
  win() {
    [523, 659, 784, 1047].forEach((f, k) => tone({ freq: f, dur: 0.32, type: 'triangle', vol: 0.12, delay: k * 0.11 }));
  },
};
