// Progress is saved only on this device, in two places at once:
//  - localStorage (fast, synchronous)
//  - IndexedDB (committed to disk transactionally; survives iOS killing the
//    Home Screen app right after a move, which can drop recent localStorage writes)
// On load, the newest copy wins. Nothing ever leaves the phone.
const KEY = 'flaskflow.v1';
const DB_NAME = 'flaskflow';
const DB_STORE = 'kv';
const CODE_PREFIX = 'FF1-';

export function defaultStore() {
  return {
    level: 1,
    stars: {},
    daily: { last: null, streak: 0, done: {} },
    settings: { sound: true, haptics: true, cb: false },
    seenTips: {},
    current: null,
    savedAt: 0,
  };
}

function normalize(d) {
  const def = defaultStore();
  if (!d || typeof d !== 'object') return def;
  const level = Number.isInteger(d.level) && d.level >= 1 ? d.level : 1;
  return {
    ...def,
    ...d,
    level,
    stars: d.stars && typeof d.stars === 'object' ? d.stars : {},
    daily: { ...def.daily, ...d.daily },
    settings: { ...def.settings, ...d.settings },
    seenTips: { ...d.seenTips },
  };
}

function parse(json) {
  if (!json) return null;
  try {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- IndexedDB

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function idbGet() {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut(json) {
  const d = await db();
  if (!d) return;
  try {
    d.transaction(DB_STORE, 'readwrite', { durability: 'strict' }).objectStore(DB_STORE).put(json, KEY);
  } catch {
    /* ignore; localStorage still has it */
  }
}

const timeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

// ---------------------------------------------------------------- public API

export async function loadStore() {
  let fromLS = null;
  try {
    fromLS = parse(localStorage.getItem(KEY));
  } catch {
    /* storage blocked */
  }
  const fromIDB = parse(await timeout(idbGet(), 1500));

  // Newest save wins; if timestamps tie, the one with more progress wins.
  const candidates = [fromLS, fromIDB].filter(Boolean);
  candidates.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0) || (b.level || 1) - (a.level || 1));
  const store = normalize(candidates[0]);

  // Heal whichever copy was missing or stale.
  if (candidates.length) writeBoth(store);
  return store;
}

function writeBoth(s) {
  const json = JSON.stringify(s);
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* private mode or full; IndexedDB may still work */
  }
  idbPut(json);
}

export function saveStore(s) {
  s.savedAt = Date.now();
  writeBoth(s);
}

/** Ask the browser not to evict our data under storage pressure. */
export function requestPersistence() {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    /* unsupported */
  }
}

// ---------------------------------------------------------------- save codes (backup / move between Safari and Home Screen)

export function exportCode(s) {
  const { level, stars, daily, settings, seenTips } = s;
  const json = JSON.stringify({ level, stars, daily, settings, seenTips });
  return CODE_PREFIX + btoa(json);
}

/** Returns a full store, or null if the code is not valid. */
export function importCode(code) {
  const raw = String(code || '').replace(/\s+/g, '');
  if (!raw.startsWith(CODE_PREFIX)) return null;
  try {
    const d = JSON.parse(atob(raw.slice(CODE_PREFIX.length)));
    if (!d || !Number.isInteger(d.level) || d.level < 1) return null;
    return normalize({ ...d, current: null });
  } catch {
    return null;
  }
}
