import { generateLevel, cloneState, hashSeed } from './engine.js';

/** Difficulty curve for the main level path. */
export function levelConfig(n) {
  let colors;
  if (n === 1) colors = 2;
  else if (n === 2) colors = 3;
  else if (n <= 5) colors = 4;
  else if (n <= 15) colors = 5;
  else if (n <= 30) colors = 6;
  else if (n <= 50) colors = 7;
  else if (n <= 80) colors = 8;
  else if (n <= 110) colors = 9;
  else if (n <= 150) colors = 10;
  else if (n <= 200) colors = 11;
  else colors = 12;

  const challenge = n >= 10 && n % 10 === 0;
  if (challenge) colors = Math.min(12, colors + 1);

  const hiddenRate = n >= 31 && n % 3 !== 0 ? Math.min(0.6, 0.3 + (n - 31) * 0.003) : 0;
  const frozen = n >= 81 && n % 2 === 0 ? 1 : 0;
  const cap = n >= 151 && n % 5 === 0 ? 5 : 4;

  return { kind: 'level', n, colors, cap, empties: 2, hiddenRate, frozen, challenge, seed: 'L' + n };
}

/** One puzzle per calendar day, mid difficulty. */
export function dailyConfig(key) {
  const h = hashSeed('daily', key);
  return {
    kind: 'daily',
    key,
    colors: 7 + (h % 3),
    cap: 4,
    empties: 2,
    hiddenRate: (h >>> 3) % 2 ? 0.35 : 0,
    frozen: (h >>> 5) % 3 === 0 ? 1 : 0,
    challenge: false,
    seed: 'D' + key,
  };
}

const cache = new Map();

export function buildLevel(cfg) {
  let lvl = cache.get(cfg.seed);
  if (!lvl) {
    lvl = generateLevel(cfg);
    cache.set(cfg.seed, lvl);
  }
  return { state: cloneState(lvl.state), par: lvl.par };
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function prevDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d - 1));
}

export function formatDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
