// All progress lives in localStorage on the device. Nothing leaves the phone.
const KEY = 'flaskflow.v1';

export function defaultStore() {
  return {
    level: 1,
    stars: {},
    daily: { last: null, streak: 0, done: {} },
    settings: { sound: true, haptics: true, cb: false },
    seenTips: {},
    current: null,
  };
}

export function loadStore() {
  const def = defaultStore();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def;
    const d = JSON.parse(raw);
    return {
      ...def,
      ...d,
      daily: { ...def.daily, ...d.daily },
      settings: { ...def.settings, ...d.settings },
      seenTips: { ...d.seenTips },
    };
  } catch {
    return def;
  }
}

export function saveStore(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode); game still works for this session */
  }
}
