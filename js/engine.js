// Core rules, seeded RNG, solver and level generator. Pure logic, no DOM.
//
// A layer is a small int: bits 0-4 = color index, bit 5 = hidden ("?") flag.
// A tube is an array of layers, bottom -> top.
// A state is { cap, tubes: number[][], frozen: boolean[] }.

export const HIDDEN = 32;
export const colorOf = (l) => l & 31;
export const isHidden = (l) => (l & HIDDEN) !== 0;

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts) {
  const s = parts.join(':');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function cloneState(s) {
  return { cap: s.cap, tubes: s.tubes.map((t) => t.slice()), frozen: s.frozen.slice() };
}

/** Full and a single color (hidden flags ignored). */
export function isComplete(tube, cap) {
  if (tube.length !== cap) return false;
  const c = colorOf(tube[0]);
  for (let k = 1; k < tube.length; k++) if (colorOf(tube[k]) !== c) return false;
  return true;
}

/** Number of revealed, same-colored layers on top. The top layer is always revealed. */
export function topRun(tube) {
  const n = tube.length;
  if (!n) return 0;
  const c = colorOf(tube[n - 1]);
  let k = 1;
  for (let i = n - 2; i >= 0; i--) {
    const l = tube[i];
    if (isHidden(l) || colorOf(l) !== c) break;
    k++;
  }
  return k;
}

export function canPour(s, i, j) {
  if (i === j) return false;
  const a = s.tubes[i];
  const b = s.tubes[j];
  if (!a || !b || !a.length) return false;
  if (s.frozen[i] || s.frozen[j]) return false;
  if (isComplete(a, s.cap)) return false;
  if (b.length >= s.cap) return false;
  if (b.length && colorOf(b[b.length - 1]) !== colorOf(a[a.length - 1])) return false;
  return true;
}

/** Mutates s. Caller must check canPour first. */
export function applyPour(s, i, j) {
  const a = s.tubes[i];
  const b = s.tubes[j];
  const color = colorOf(a[a.length - 1]);
  const amount = Math.min(topRun(a), s.cap - b.length);
  for (let k = 0; k < amount; k++) b.push(a.pop() & ~HIDDEN);

  let revealed = false;
  if (a.length && isHidden(a[a.length - 1])) {
    a[a.length - 1] &= ~HIDDEN;
    revealed = true;
  }

  const completed = [];
  if (isComplete(b, s.cap)) {
    for (let k = 0; k < b.length; k++) b[k] &= ~HIDDEN;
    completed.push(j);
  }

  const thawed = [];
  if (completed.length) {
    for (let k = 0; k < s.frozen.length; k++) {
      if (s.frozen[k]) {
        s.frozen[k] = false;
        thawed.push(k);
      }
    }
  }
  return { amount, color, revealed, completed, thawed };
}

export function isWon(s) {
  return s.tubes.every((t) => t.length === 0 || isComplete(t, s.cap));
}

export function hasMoves(s) {
  const n = s.tubes.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (canPour(s, i, j)) return true;
  return false;
}

// ---------------------------------------------------------------- solver

/** Candidate moves, pruned of pointless ones and ordered best-first. */
function orderedMoves(s) {
  const n = s.tubes.length;
  const cap = s.cap;
  let firstEmpty = -1;
  for (let j = 0; j < n; j++) {
    if (!s.tubes[j].length && !s.frozen[j]) {
      firstEmpty = j;
      break;
    }
  }
  const moves = [];
  for (let i = 0; i < n; i++) {
    const a = s.tubes[i];
    if (!a.length || s.frozen[i] || isComplete(a, cap)) continue;
    const run = topRun(a);
    const pure = run === a.length;
    const top = colorOf(a[a.length - 1]);
    for (let j = 0; j < n; j++) {
      if (i === j || s.frozen[j]) continue;
      const b = s.tubes[j];
      if (b.length >= cap) continue;
      if (!b.length) {
        if (j !== firstEmpty || pure) continue; // empties are interchangeable; pure->empty is pointless
        moves.push({ i, j, score: 2 });
        continue;
      }
      if (colorOf(b[b.length - 1]) !== top) continue;
      const amt = Math.min(run, cap - b.length);
      const bPure = topRun(b) === b.length;
      let score = 10;
      if (amt === run) score += 5;
      if (bPure && b.length + amt === cap) score += 20;
      if (pure && amt === run) score += 3;
      if (pure && !bPure) score -= 12; // moving a sorted stack onto a mixed one
      moves.push({ i, j, score });
    }
  }
  moves.sort((x, y) => y.score - x.score);
  return moves;
}

function stateKey(s) {
  const parts = new Array(s.tubes.length);
  for (let k = 0; k < s.tubes.length; k++) parts[k] = (s.frozen[k] ? 'F' : '') + s.tubes[k].join('.');
  parts.sort();
  return parts.join('|');
}

const LIMIT = Symbol('limit');

/**
 * Depth-first search with memo.
 * Returns an array of [from, to] moves, null if provably unsolvable,
 * or undefined if it gave up after maxNodes.
 */
export function solve(start, { maxNodes = 200000 } = {}) {
  const seen = new Set();
  const path = [];
  let nodes = 0;

  function dfs(st) {
    if (isWon(st)) return true;
    if (++nodes > maxNodes) throw LIMIT;
    const key = stateKey(st);
    if (seen.has(key)) return false;
    seen.add(key);
    for (const { i, j } of orderedMoves(st)) {
      const next = cloneState(st);
      applyPour(next, i, j);
      path.push([i, j]);
      if (dfs(next)) return true;
      path.pop();
    }
    return false;
  }

  try {
    return dfs(cloneState(start)) ? path.slice() : null;
  } catch (e) {
    if (e === LIMIT) return undefined;
    throw e;
  }
}

// ---------------------------------------------------------------- generator

/**
 * Build a random, solver-verified level. Deterministic for a given seed.
 * cfg: { colors, cap, empties, hiddenRate, frozen, seed }
 */
export function generateLevel(cfg) {
  const { colors, cap = 4, hiddenRate = 0, frozen = 0, seed } = cfg;
  for (let attempt = 0; attempt < 80; attempt++) {
    const rng = mulberry32(hashSeed(seed, attempt));
    const empties = (cfg.empties ?? 2) + (attempt >= 50 ? 1 : 0);

    const pool = [];
    for (let c = 0; c < colors; c++) for (let k = 0; k < cap; k++) pool.push(c);
    shuffle(pool, rng);

    const tubes = [];
    for (let c = 0; c < colors; c++) tubes.push(pool.slice(c * cap, (c + 1) * cap));
    if (tubes.some((t) => isComplete(t, cap) || topRun(t) >= cap - 1)) continue;

    if (hiddenRate > 0) {
      for (const t of tubes) for (let k = 0; k < t.length - 1; k++) if (rng() < hiddenRate) t[k] |= HIDDEN;
    }

    const fr = tubes.map(() => false);
    const order = shuffle(tubes.map((_, k) => k), rng);
    for (let k = 0; k < Math.min(frozen, tubes.length - 2); k++) fr[order[k]] = true;

    for (let k = 0; k < empties; k++) {
      tubes.push([]);
      fr.push(false);
    }

    const state = { cap, tubes, frozen: fr };
    const sol = solve(state, { maxNodes: 120000 });
    if (sol && sol.length) return { state, par: sol.length, attempt };
  }
  throw new Error('Could not generate level for seed ' + seed);
}
