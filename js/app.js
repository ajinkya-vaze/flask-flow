import {
  cloneState, canPour, applyPour, isComplete, isWon, hasMoves, isHidden, colorOf, solve,
} from './engine.js';
import { levelConfig, dailyConfig, buildLevel, todayKey, prevDayKey, formatDayKey } from './levels.js';
import { sfx, unlockAudio, setSoundEnabled } from './audio.js';
import { haptic, setHapticsEnabled } from './haptics.js';
import { loadStore, saveStore, defaultStore } from './storage.js';

// Ordered so that the first few colors (used in early levels) are the most distinct.
const COLORS = [
  '#ef3e4a', // red
  '#3557e8', // blue
  '#ffd23b', // yellow
  '#2fb35a', // green
  '#9152e8', // purple
  '#ff8a2a', // orange
  '#ff7ac3', // pink
  '#12a8a0', // teal
  '#94582d', // brown
  '#b7e34a', // lime
  '#f4f4fa', // white
  '#7fd6ff', // sky
];
const SYMBOLS = ['●', '■', '▲', '◆', '★', '✚', '♥', '▼', '◗', '✖', '○', '≋'].map((s) => s + '︎');

const $ = (sel) => document.querySelector(sel);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait for an animation, but never longer than its duration + slack (the animation
 *  clock pauses while the app is in the background, which must not lock the game). */
const played = (anim, ms) => Promise.race([anim.finished.catch(() => {}), wait(ms + 150)]);

let store = loadStore();
let game = null;
let tubeEls = [];
let layout = { tw: 40, lh: 36, th: 150 };
const busy = new Set();
const anims = new Set();
let toastTimer = null;
let hintTimer = null;

// ================================================================ utilities

function persistStore() {
  saveStore(store);
}

function persistGame() {
  if (!game) return;
  store.current = game.won
    ? null
    : {
        mode: game.mode,
        id: game.id,
        state: game.state,
        initial: game.initial,
        history: game.history.slice(-300),
        extraUsed: game.extraUsed,
        par: game.par,
      };
  persistStore();
}

function applySettings() {
  setSoundEnabled(store.settings.sound);
  setHapticsEnabled(store.settings.haptics);
  document.body.classList.toggle('cb', store.settings.cb);
}

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2300);
}

const settle = () => Promise.all([...anims]);
function track(p) {
  anims.add(p);
  p.finally(() => anims.delete(p));
  return p;
}

// ================================================================ flask DOM

function makeLayer(l) {
  const d = document.createElement('div');
  d.className = 'layer';
  if (isHidden(l)) d.classList.add('hidden');
  else {
    const c = colorOf(l);
    d.style.setProperty('--c', COLORS[c]);
    d.dataset.sym = SYMBOLS[c];
  }
  return d;
}

function makeTubeEl() {
  const el = document.createElement('div');
  el.className = 'tube';
  el.innerHTML =
    '<div class="rim"></div><div class="glass"><div class="liquid"></div></div>' +
    '<div class="ice">❄︎</div><div class="cork"></div><div class="hint-ring"></div><div class="hint-tag"></div>';
  return el;
}

function fillTube(el, tube, { frozen = false, cap = 4 } = {}) {
  el.classList.remove('just-done', 'thawing');
  el.classList.toggle('frozen', frozen);
  el.classList.toggle('done', isComplete(tube, cap));
  const liq = el.querySelector('.liquid');
  liq.replaceChildren(...tube.map(makeLayer));
}

function renderTube(i) {
  const s = game.state;
  const el = tubeEls[i];
  fillTube(el, s.tubes[i], { frozen: s.frozen[i], cap: s.cap });
  el.classList.toggle('selected', game.selected === i);
}

function renderAllTubes() {
  tubeEls.forEach((_, i) => renderTube(i));
}

function renderBoard() {
  const board = $('#board');
  board.replaceChildren();
  tubeEls = [];
  const s = game.state;
  const n = s.tubes.length;
  const rect = board.getBoundingClientRect();
  const rows = n <= 6 ? 1 : n <= 14 ? 2 : 3;
  const perRow = Math.ceil(n / rows);

  const slot = (rect.width - 24) / perRow;
  const tw = Math.min(58, slot * 0.7);
  const gap = Math.min(30, slot - tw);
  const rowGap = rows > 1 ? 52 : 0;
  const rowH = (rect.height - 40 - rowGap * (rows - 1)) / rows;
  const lh = Math.max(12, Math.min(tw * 0.95, rowH / (s.cap + 0.7)));
  const th = lh * (s.cap + 0.7);
  layout = { tw, lh, th };
  board.style.setProperty('--tw', tw + 'px');
  board.style.setProperty('--lh', lh + 'px');
  board.style.setProperty('--th', th + 'px');
  board.style.setProperty('--gap', gap + 'px');
  board.style.setProperty('--rowgap', rowGap + 'px');

  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const row = document.createElement('div');
    row.className = 'row';
    const count = Math.ceil((n - idx) / (rows - r));
    for (let k = 0; k < count; k++) {
      const i = idx++;
      const el = makeTubeEl();
      el.addEventListener('click', () => onTubeTap(i));
      tubeEls[i] = el;
      row.append(el);
    }
    board.append(row);
  }
  renderAllTubes();
}

// ================================================================ home

function renderHero() {
  const hero = $('#hero');
  const demo = [[0, 1, 2], [3, 3, 3, 3], [2, 0, 1, 0]];
  hero.replaceChildren(
    ...demo.map((t) => {
      const el = makeTubeEl();
      fillTube(el, t);
      return el;
    })
  );
}

function renderHome() {
  game = null;
  const cur = store.current;
  const resuming = cur && cur.mode === 'level' && cur.id === store.level && cur.history?.length;
  $('#play-label').textContent = resuming ? 'Continue' : 'Play';
  $('#play-sub').textContent = `Level ${store.level}`;
  const key = todayKey();
  const d = store.daily;
  const done = !!d.done[key];
  const streak = d.last === key || d.last === prevDayKey(key) ? d.streak : 0;
  $('#daily-date').textContent = formatDayKey(key);
  $('#daily-status').textContent = done ? 'Solved ✓' : 'Play';
  $('#daily-streak').textContent = streak ? `🔥 ${streak}-day streak` : 'Solve today to start a streak';
  $('#daily-card').classList.toggle('done', done);
  show('home');
}

function renderLevels() {
  const grid = $('#level-grid');
  grid.replaceChildren();
  const total = Object.values(store.stars).reduce((a, b) => a + b, 0);
  $('#levels-sub').textContent = `${store.level - 1} solved · ${total} ★`;
  for (let n = 1; n <= store.level; n++) {
    const b = document.createElement('button');
    b.className = 'lvl';
    if (n === store.level) b.classList.add('current');
    if (levelConfig(n).challenge) b.classList.add('challenge');
    const st = store.stars[n] || 0;
    b.innerHTML = `${n}<small>${'★'.repeat(st)}</small>`;
    b.addEventListener('click', () => startGame('level', n));
    grid.append(b);
  }
  show('levels');
  grid.querySelector('.current')?.scrollIntoView({ block: 'center' });
}

// ================================================================ game lifecycle

function tipFor(cfg) {
  if (cfg.kind !== 'level') return '';
  if (cfg.n <= 2) return 'Tap a flask, then tap another to pour. You can pour onto the same color or into an empty flask.';
  if (cfg.n === 3) return 'Fill every flask with a single color to win.';
  if (cfg.n === 31) return 'New: hidden layers (?) show their color once uncovered.';
  if (cfg.n === 82) return 'New: frozen flasks thaw as soon as you complete any color.';
  if (cfg.challenge && !store.seenTips.challenge) {
    store.seenTips.challenge = true;
    return 'Challenge level: one extra color!';
  }
  return '';
}

function startGame(mode, id) {
  const cfg = mode === 'level' ? levelConfig(id) : dailyConfig(id);
  const cur = store.current;
  let state, initial, history, extraUsed, par;
  if (cur && cur.mode === mode && cur.id === id && cur.initial) {
    ({ state, initial, history, extraUsed, par } = cur);
  } else {
    const lvl = buildLevel(cfg);
    state = lvl.state;
    initial = cloneState(lvl.state);
    history = [];
    extraUsed = false;
    par = lvl.par;
  }
  game = { mode, id, cfg, state, initial, history, extraUsed, par, selected: -1, won: false };

  $('#game-title').textContent = mode === 'level' ? `Level ${id}${cfg.challenge ? ' ★' : ''}` : `Daily · ${formatDayKey(id)}`;
  $('#game').classList.toggle('challenge', !!cfg.challenge);
  $('#tip').textContent = tipFor(cfg);
  hideStuck();
  closeModal();
  show('game');
  renderBoard(); // getBoundingClientRect forces layout, so the new screen is already measured
  updateHud();
  if (mode === 'level' && id === 1 && !history.length) setTimeout(hint, 500);
  persistGame();
}

function updateHud() {
  $('#game-sub').textContent = `Moves ${game.history.length}`;
  $('#undo-btn').disabled = !game.history.length;
  $('#flask-btn').classList.toggle('used', game.extraUsed);
  $('#flask-btn').disabled = game.extraUsed;
  $('#stuck-flask').style.display = game.extraUsed ? 'none' : '';
}

// ================================================================ input

function pickable(k) {
  const s = game.state;
  return s.tubes[k].length > 0 && !s.frozen[k] && !isComplete(s.tubes[k], s.cap);
}

function setSelected(k) {
  const prev = game.selected;
  game.selected = k;
  if (prev >= 0 && tubeEls[prev]) tubeEls[prev].classList.remove('selected');
  if (k >= 0) tubeEls[k].classList.add('selected');
}

function shake(i) {
  const el = tubeEls[i];
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 350);
}

function onTubeTap(i) {
  unlockAudio();
  if (!game || game.won || busy.has(i)) return;
  clearHint();
  hideStuck();
  const s = game.state;
  const sel = game.selected;

  if (sel === -1) {
    if (pickable(i)) {
      setSelected(i);
      sfx.select();
      haptic();
    } else {
      shake(i);
      sfx.invalid();
      if (s.frozen[i]) toast('Frozen: complete any color to thaw it');
    }
    return;
  }
  if (sel === i) {
    setSelected(-1);
    return;
  }
  if (canPour(s, sel, i)) {
    haptic();
    doPour(sel, i);
    return;
  }
  // Not a valid target: switch selection if possible, otherwise put the flask back down.
  shake(i);
  sfx.invalid();
  if (pickable(i) && !s.frozen[i]) setSelected(i);
  else setSelected(-1);
}

function doPour(i, j) {
  const s = game.state;
  const dstLenBefore = s.tubes[j].length;
  game.selected = -1;
  game.history.push(cloneState(s));
  const res = applyPour(s, i, j);
  updateHud();
  persistGame();

  track(
    animatePour(i, j, res, dstLenBefore).then(() => {
      if (!game || !tubeEls[i]) return;
      renderTube(i);
      renderTube(j);
      if (res.revealed) {
        const top = tubeEls[i].querySelector('.liquid').lastElementChild;
        top?.classList.add('reveal');
      }
      if (res.completed.length && isComplete(game.state.tubes[j], s.cap)) {
        tubeEls[j].classList.add('just-done');
        sfx.complete();
        sparkle(j);
      }
      if (res.thawed.length) {
        sfx.thaw();
        res.thawed.forEach((k) => {
          tubeEls[k].classList.add('thawing');
          setTimeout(() => game && tubeEls[k] && renderTube(k), 450);
        });
      }
    })
  );

  if (isWon(s)) {
    game.won = true;
    settle().then(() => setTimeout(onWin, 250));
  } else if (!hasMoves(s)) {
    settle().then(() => {
      if (game && !game.won && !hasMoves(game.state)) showStuck();
    });
  }
}

// ================================================================ pour animation

async function animatePour(i, j, res, dstLenBefore) {
  const src = tubeEls[i];
  const dst = tubeEls[j];
  const board = $('#board');
  busy.add(i);
  busy.add(j);
  src.classList.remove('selected');

  const { tw, lh, th } = layout;
  const sx = src.offsetLeft, sy = src.offsetTop;
  const dx = dst.offsetLeft, dy = dst.offsetTop;
  // Tip past horizontal so the mouth is lower than the base. The body swings
  // toward the screen side with more room (dir 1 = body to the left).
  const dir = dx + tw / 2 > board.clientWidth / 2 ? 1 : -1;
  const angle = dir * 104;
  const rad = (angle * Math.PI) / 180;
  // Rotation pivots on the mouth's center. Place the pouring lip above the target's mouth.
  const lipX = (tw / 2) * Math.cos(rad) * dir;
  const lipY = (tw / 2) * Math.abs(Math.sin(rad));
  const hover = 26 + lipY;
  const tx = dx - sx - lipX * 0.6;
  const ty = dy - sy - hover;

  src.style.zIndex = 20;
  const lift = 'translate(0px, -22px) rotate(0deg)';
  const over = `translate(${tx}px, ${ty}px) rotate(${angle}deg)`;
  const tilted = `translate(${tx}px, ${ty}px) rotate(${angle * 1.1}deg)`;
  const ease = 'cubic-bezier(.3,.7,.3,1)';

  await played(src.animate([{ transform: lift }, { transform: over }], { duration: 230, easing: ease, fill: 'forwards' }), 230);

  sfx.pour(res.amount);
  const pourDur = 230 + 70 * res.amount;
  const sw = Math.max(4, tw * 0.16);
  const streamTop = dy - 26;
  const surface = dy + th - dstLenBefore * lh;
  const stream = document.createElement('div');
  stream.className = 'stream';
  Object.assign(stream.style, {
    left: dx + tw / 2 - sw / 2 + 'px',
    top: streamTop + 'px',
    width: sw + 'px',
    height: Math.max(0, surface - streamTop) + 'px',
    background: COLORS[res.color],
  });
  board.append(stream);
  stream.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 90, fill: 'forwards' });

  src.animate([{ transform: over }, { transform: tilted }], { duration: pourDur, fill: 'forwards' });
  const outgoing = [...src.querySelectorAll('.layer')].slice(-res.amount);
  outgoing.forEach((el) => el.animate([{ height: lh + 'px' }, { height: '0px' }], { duration: pourDur, fill: 'forwards' }));
  const liq = dst.querySelector('.liquid');
  for (let k = 0; k < res.amount; k++) {
    const el = makeLayer(res.color);
    el.style.height = '0px';
    liq.append(el);
    el.animate([{ height: '0px' }, { height: lh + 'px' }], {
      duration: pourDur / res.amount,
      delay: 70 + (k * pourDur) / res.amount,
      fill: 'forwards',
    });
  }

  await wait(pourDur + 80);
  await played(stream.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' }), 90);
  stream.remove();

  const back = src.animate([{ transform: tilted }, { transform: 'translate(0px, 0px) rotate(0deg)' }], {
    duration: 230,
    easing: ease,
    fill: 'forwards',
  });
  await played(back, 230);
  src.getAnimations().forEach((a) => a.cancel());
  src.style.zIndex = '';
  busy.delete(i);
  busy.delete(j);
}

// ================================================================ effects

function sparkle(i) {
  const el = tubeEls[i];
  if (!el) return;
  const r = el.getBoundingClientRect();
  const fx = $('#fx');
  const cx = r.left + r.width / 2;
  const cy = r.top;
  for (let k = 0; k < 12; k++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 4 + Math.random() * 4;
    Object.assign(p.style, {
      left: cx + 'px', top: cy + 'px', width: size + 'px', height: size + 'px',
      borderRadius: '50%', background: k % 2 ? '#fff6c2' : '#ffd23b',
    });
    fx.append(p);
    const a = (Math.PI * 2 * k) / 12;
    const dist = 30 + Math.random() * 26;
    p.animate(
      [
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * dist - size / 2}px, ${Math.sin(a) * dist - size / 2}px) scale(.3)`, opacity: 0 },
      ],
      { duration: 600, easing: 'cubic-bezier(.2,.8,.3,1)' }
    );
    setTimeout(() => p.remove(), 700);
  }
}

function confetti() {
  const fx = $('#fx');
  const W = window.innerWidth;
  const H = window.innerHeight;
  for (let k = 0; k < 70; k++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const w = 6 + Math.random() * 6;
    Object.assign(p.style, {
      left: Math.random() * W + 'px', top: '-20px', width: w + 'px', height: w * 1.5 + 'px',
      background: COLORS[k % COLORS.length],
    });
    fx.append(p);
    const drift = (Math.random() - 0.5) * 160;
    p.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${drift}px, ${H + 40}px) rotate(${360 + Math.random() * 540}deg)`, opacity: 0.9 },
      ],
      { duration: 1600 + Math.random() * 1200, delay: Math.random() * 400, easing: 'cubic-bezier(.25,.6,.4,1)', fill: 'forwards' }
    );
    setTimeout(() => p.remove(), 3300);
  }
}

// ================================================================ helpers (undo/hint/flask/restart)

async function undo() {
  if (!game || game.won) return;
  await settle();
  if (!game.history.length) return;
  clearHint();
  hideStuck();
  game.state = game.history.pop();
  game.selected = -1;
  renderAllTubes();
  updateHud();
  persistGame();
  sfx.undo();
}

async function restart() {
  if (!game) return;
  await settle();
  clearHint();
  hideStuck();
  game.state = cloneState(game.initial);
  game.history = [];
  game.extraUsed = false;
  game.selected = -1;
  game.won = false;
  renderBoard();
  updateHud();
  persistGame();
}

async function addFlask() {
  if (!game || game.won) return;
  if (game.extraUsed) {
    toast('Only one extra flask per level');
    return;
  }
  await settle();
  clearHint();
  hideStuck();
  game.extraUsed = true;
  const add = (st) => {
    st.tubes.push([]);
    st.frozen.push(false);
  };
  add(game.state);
  game.history.forEach(add);
  game.selected = -1;
  renderBoard();
  updateHud();
  persistGame();
}

async function hint() {
  if (!game || game.won) return;
  await settle();
  hideStuck();
  setSelected(-1);
  clearHint();
  const path = solve(game.state, { maxNodes: 60000 });
  if (path && path.length) {
    const [a, b] = path[0];
    tubeEls[a].classList.add('hint-src');
    tubeEls[b].classList.add('hint-dst');
    hintTimer = setTimeout(clearHint, 4000);
    return;
  }
  if (path === null && !game.extraUsed) {
    const withFlask = cloneState(game.state);
    withFlask.tubes.push([]);
    withFlask.frozen.push(false);
    if (Array.isArray(solve(withFlask, { maxNodes: 60000 }))) {
      toast('Add the extra flask to keep going, or Undo');
      return;
    }
  }
  toast(path === null ? 'No way forward from here, try Undo' : 'Tricky spot! Try undoing a few moves');
}

function clearHint() {
  clearTimeout(hintTimer);
  tubeEls.forEach((el) => el.classList.remove('hint-src', 'hint-dst'));
}

function showStuck() {
  $('#stuck').classList.add('show');
}
function hideStuck() {
  $('#stuck').classList.remove('show');
}

// ================================================================ win

function onWin() {
  if (!game) return;
  const moves = game.history.length;
  const par = game.par;
  const stars = moves <= par ? 3 : moves <= Math.ceil(par * 1.25) + 2 ? 2 : 1;
  sfx.win();
  confetti();

  if (game.mode === 'level') {
    store.stars[game.id] = Math.max(store.stars[game.id] || 0, stars);
    if (game.id === store.level) store.level++;
  } else {
    const d = store.daily;
    const key = game.id;
    if (!d.done[key]) {
      d.streak = d.last === prevDayKey(key) ? d.streak + 1 : 1;
      d.last = key;
      d.done[key] = true;
      // keep the done map small
      const keys = Object.keys(d.done).sort();
      while (keys.length > 60) delete d.done[keys.shift()];
    }
  }
  store.current = null;
  persistStore();

  const isLevel = game.mode === 'level';
  const nextId = isLevel ? game.id + 1 : null;
  setTimeout(() => {
    openModal(`
      <div class="stars">${[1, 2, 3].map((k) => `<span class="${k <= stars ? 'on' : ''}">★</span>`).join('')}</div>
      <h2>${isLevel ? `Level ${game.id} solved!` : 'Daily solved!'}</h2>
      <p class="muted">${moves} moves · par ${par}</p>
      ${!isLevel ? `<p class="streak">🔥 ${store.daily.streak}-day streak</p>` : ''}
      <div class="modal-actions">
        ${isLevel ? `<button class="btn primary" data-act="next">Level ${nextId} →</button>` : ''}
        <button class="btn" data-act="home">Home</button>
      </div>`,
      {
        next: () => startGame('level', nextId),
        home: () => {
          closeModal();
          renderHome();
        },
      },
      false
    );
  }, 650);
}

// ================================================================ modal + settings

let modalHandlers = {};
let modalDismissable = true;

function openModal(html, handlers = {}, dismissable = true) {
  $('#modal-card').innerHTML = html;
  modalHandlers = handlers;
  modalDismissable = dismissable;
  $('#modal').classList.add('show');
}
function closeModal() {
  $('#modal').classList.remove('show');
}

function openSettings() {
  const st = store.settings;
  const row = (key, label, sub) => `
    <label class="setting"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span>
      <input type="checkbox" switch data-setting="${key}" ${st[key] ? 'checked' : ''}></label>`;
  openModal(
    `<h2>Settings</h2>
     <div class="settings-list">
       ${row('sound', 'Sound')}
       ${row('haptics', 'Haptics', 'iPhone with iOS 18 or later')}
       ${row('cb', 'Color-blind symbols', 'Adds a shape to every color')}
     </div>
     <div class="modal-actions">
       <button class="btn primary" data-act="close">Done</button>
       <button class="btn danger small" data-act="reset" id="reset-btn">Reset all progress</button>
     </div>`,
    {
      close: closeModal,
      reset: (btn) => {
        if (btn.dataset.armed) {
          const settings = store.settings;
          store = defaultStore();
          store.settings = settings;
          persistStore();
          closeModal();
          renderHome();
          toast('Progress reset');
        } else {
          btn.dataset.armed = '1';
          btn.textContent = 'Tap again to erase everything';
        }
      },
    }
  );
  $('#modal-card').querySelectorAll('[data-setting]').forEach((inp) => {
    inp.addEventListener('change', () => {
      store.settings[inp.dataset.setting] = inp.checked;
      applySettings();
      persistStore();
    });
  });
}

// ================================================================ wiring

function bind() {
  $('#play-btn').addEventListener('click', () => {
    unlockAudio();
    startGame('level', store.level);
  });
  $('#daily-card').addEventListener('click', () => {
    unlockAudio();
    startGame('daily', todayKey());
  });
  $('#levels-btn').addEventListener('click', renderLevels);
  $('#levels-back').addEventListener('click', renderHome);
  $('#home-settings').addEventListener('click', openSettings);
  $('#game-settings').addEventListener('click', openSettings);
  $('#back-btn').addEventListener('click', async () => {
    await settle();
    if (game && !game.won) persistGame();
    renderHome();
  });
  $('#restart-btn').addEventListener('click', restart);
  $('#undo-btn').addEventListener('click', undo);
  $('#hint-btn').addEventListener('click', hint);
  $('#flask-btn').addEventListener('click', addFlask);
  $('#stuck').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'undo') undo();
    else if (act === 'restart') restart();
    else if (act === 'flask') addFlask();
  });
  $('#modal').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn && modalHandlers[btn.dataset.act]) modalHandlers[btn.dataset.act](btn);
    else if (e.target.id === 'modal' && modalDismissable) closeModal();
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(async () => {
      if (!game || !$('#game').classList.contains('active')) return;
      await settle();
      renderBoard();
    }, 150);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistGame();
  });
}

function init() {
  applySettings();
  renderHero();
  bind();
  renderHome();
  navigator.storage?.persist?.().catch(() => {});
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.__flask = {
      startGame,
      get game() { return game; },
      get store() { return store; },
      get idle() { return anims.size === 0 && busy.size === 0; },
    };
  }
  const forceSW = new URLSearchParams(location.search).has('sw');
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || forceSW)) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
