'use strict';
const $ = id => document.getElementById(id);
const store = chrome.storage.local;
const uid = () => crypto.randomUUID();

/* ───────── Clock (12-hour, updates once a minute) ───────── */
const hm = $('hm'), ap = $('ap'), dateEl = $('date');
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
let clockT;
function tickClock() {
  const d = new Date(), h = d.getHours();
  hm.textContent = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
  ap.textContent = h < 12 ? 'AM' : 'PM';
  dateEl.textContent = dateFmt.format(d);
  clearTimeout(clockT);
  clockT = setTimeout(tickClock, 60000 - (Date.now() % 60000) + 30);
}

/* ───────── Background (default or user upload, kept in IndexedDB) ───────── */
const bg = $('bg');
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('meadow-tab', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction('kv').objectStore('kv').get(k);
    q.onsuccess = () => { db.close(); res(q.result); };
    q.onerror = () => { db.close(); rej(q.error); };
  });
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readwrite');
    v === undefined ? t.objectStore('kv').delete(k) : t.objectStore('kv').put(v, k);
    t.oncomplete = () => { db.close(); res(); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}
async function loadBg() {
  try {
    const blob = await idbGet('bg');
    if (blob) {
      bg.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
      bg.classList.remove('pixel');
    }
  } catch {}
  bg.classList.add('ready');
}
async function downscale(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 2560 / bmp.width);
  const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
}

/* ───────── Search + suggestions ───────── */
const q = $('q'), sugg = $('sugg'), form = $('searchForm');
let items = [], sel = -1, typed = '', ctl, deb;

function looksLikeUrl(t) {
  if (/\s/.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?([\/?#]|$)/i.test(t)) return 'http://' + t;
  if (/^[^\s\/]+\.[a-z]{2,}(:\d+)?([\/?#].*)?$/i.test(t)) return 'https://' + t;
  return null;
}
function go(text) {
  text = text.trim();
  if (!text) return;
  const u = looksLikeUrl(text);
  if (u) location.href = u;
  else chrome.search.query({ text, disposition: 'CURRENT_TAB' });
}
function hideSugg() { sugg.hidden = true; items = []; sel = -1; }
function showSugg() {
  if (!items.length) return hideSugg();
  const f = document.createDocumentFragment();
  items.forEach((s, i) => {
    const li = document.createElement('li');
    li.dataset.i = i;
    const t = typed.toLowerCase();
    if (s.toLowerCase().startsWith(t)) {
      li.append(s.slice(0, t.length));
      const b = document.createElement('b');
      b.textContent = s.slice(t.length);
      li.append(b);
    } else li.textContent = s;
    f.append(li);
  });
  sugg.replaceChildren(f);
  sugg.hidden = false;
  sel = -1;
}
async function fetchSugg(v) {
  ctl?.abort();
  ctl = new AbortController();
  try {
    const r = await fetch('https://suggestqueries.google.com/complete/search?client=chrome&q=' + encodeURIComponent(v), { signal: ctl.signal });
    const j = await r.json();
    if (q.value.trim() !== v) return;
    typed = v;
    items = (j[1] || []).slice(0, 8);
    showSugg();
  } catch {}
}
function mark() {
  [...sugg.children].forEach((li, i) => li.classList.toggle('on', i === sel));
}
q.addEventListener('input', () => {
  clearTimeout(deb);
  const v = q.value.trim();
  if (!v) { ctl?.abort(); return hideSugg(); }
  deb = setTimeout(() => fetchSugg(v), 110);
});
q.addEventListener('keydown', e => {
  if (sugg.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = items.length;
    sel = e.key === 'ArrowDown' ? (sel + 1 >= n ? -1 : sel + 1) : (sel - 1 < -1 ? n - 1 : sel - 1);
    q.value = sel === -1 ? typed : items[sel];
    mark();
  } else if (e.key === 'Escape') hideSugg();
});
q.addEventListener('blur', () => setTimeout(hideSugg, 120));
sugg.addEventListener('mousedown', e => e.preventDefault());
sugg.addEventListener('click', e => {
  const li = e.target.closest('li');
  if (li) go(items[+li.dataset.i]);
});
form.addEventListener('submit', e => { e.preventDefault(); go(q.value); });

/* ───────── Shortcuts ───────── */
const icons = $('icons');
const DEFAULTS = [
  { name: 'YouTube', url: 'https://www.youtube.com/' },
  { name: 'Gmail', url: 'https://mail.google.com/' },
  { name: 'GitHub', url: 'https://github.com/' }
];
let marks = [];
const favicon = u => `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(u)}&size=64`;
const saveMarks = () => store.set({ marks });

function renderMarks() {
  const f = document.createDocumentFragment();
  for (const m of marks) {
    const a = document.createElement('a');
    a.className = 'app'; a.href = m.url; a.dataset.id = m.id; a.draggable = false;
    const t = document.createElement('span'); t.className = 'tile';
    const img = new Image(); img.alt = ''; img.src = favicon(m.url);
    t.append(img);
    const l = document.createElement('span'); l.className = 'lbl'; l.textContent = m.name;
    a.append(t, l); f.append(a);
  }
  const add = document.createElement('button');
  add.className = 'app add'; add.id = 'addBtn'; add.type = 'button';
  const at = document.createElement('span'); at.className = 'tile'; at.textContent = '+';
  const al = document.createElement('span'); al.className = 'lbl'; al.textContent = 'Add';
  add.append(at, al); f.append(add);
  icons.replaceChildren(f);
}
async function loadMarks() {
  const { marks: m } = await store.get('marks');
  marks = m || DEFAULTS.map(x => ({ ...x, id: uid() }));
  if (!m) saveMarks();
  renderMarks();
}

const dlg = $('dlg'), dName = $('dName'), dUrl = $('dUrl');
let editId = null;
function normUrl(s) {
  s = s.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
}
function openDlg(m) {
  editId = m?.id || null;
  $('dlgTitle').textContent = m ? 'Edit shortcut' : 'Add shortcut';
  dName.value = m?.name || '';
  dUrl.value = m?.url || '';
  dlg.showModal();
  dUrl.focus();
}
$('dlgForm').addEventListener('submit', e => {
  e.preventDefault();
  const url = normUrl(dUrl.value);
  if (!url) { dUrl.setCustomValidity('Enter a valid website'); dUrl.reportValidity(); return; }
  const name = dName.value.trim() || new URL(url).hostname.replace(/^www\./, '');
  if (editId) marks = marks.map(m => m.id === editId ? { ...m, name, url } : m);
  else marks.push({ id: uid(), name, url });
  saveMarks(); renderMarks(); dlg.close();
});
dUrl.addEventListener('input', () => dUrl.setCustomValidity(''));
$('dCancel').onclick = () => dlg.close();

icons.addEventListener('click', e => { if (e.target.closest('#addBtn')) openDlg(); });

/* right-click menu: edit / remove */
const ctx = $('ctx');
let ctxId = null;
icons.addEventListener('contextmenu', e => {
  const a = e.target.closest('a.app[data-id]');
  if (!a) return;
  e.preventDefault();
  ctxId = a.dataset.id;
  ctx.hidden = false;
  ctx.style.left = Math.min(e.clientX, innerWidth - 210) + 'px';
  ctx.style.top = Math.min(e.clientY, innerHeight - 110) + 'px';
});
ctx.addEventListener('click', e => {
  const act = e.target.dataset.a;
  if (!act) return;
  if (act === 'edit') openDlg(marks.find(m => m.id === ctxId));
  if (act === 'del') { marks = marks.filter(m => m.id !== ctxId); saveMarks(); renderMarks(); }
  ctx.hidden = true;
});

/* ───────── Settings ───────── */
const settings = $('settings');
$('gear').onclick = e => { e.stopPropagation(); settings.hidden = !settings.hidden; };
$('bgPick').onclick = () => $('bgFile').click();
$('bgFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const blob = await downscale(file);
    await idbSet('bg', blob);
    bg.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
    bg.classList.remove('pixel');
  } catch {}
  settings.hidden = true;
  e.target.value = '';
};
$('bgReset').onclick = async () => {
  await idbSet('bg', undefined);
  bg.style.backgroundImage = '';
  bg.classList.add('pixel');
  settings.hidden = true;
};
document.addEventListener('click', e => {
  if (!settings.contains(e.target)) settings.hidden = true;
  ctx.hidden = true;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { settings.hidden = true; ctx.hidden = true; } });

/* ───────── Focus timer ───────── */
const T = { min: 25, st: { status: 'idle' } };
const tInput = $('tInput'), tShow = $('tShow'), tEdit = $('tEdit'), tMain = $('tMain'), tReset = $('tReset');
const tMinus = $('tMinus'), tPlus = $('tPlus'), tBox = $('timer');
let tInt = null, ringSent = false;
const clampMin = n => Math.min(180, Math.max(1, Math.round(n) || 25));
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function remaining() {
  const { status, endTime, remaining: r } = T.st;
  if (status === 'running') return Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  if (status === 'paused') return r;
  if (status === 'done') return 0;
  return T.min * 60;
}
function updateShow() {
  const s = remaining();
  tShow.textContent = T.st.status === 'done' ? "Time's up" : fmt(s);
  document.title = T.st.status === 'running' ? `${fmt(s)} · Focus` : 'New Tab';
  if (T.st.status === 'running' && s <= 0 && !ringSent) {
    ringSent = true;                       // backup in case the alarm is a few seconds late
    chrome.runtime.sendMessage({ type: 'ring' });
  }
}
function renderTimer() {
  const s = T.st.status, idle = s === 'idle';
  tBox.dataset.state = s;
  tEdit.hidden = !idle; tMinus.hidden = !idle; tPlus.hidden = !idle;
  tShow.hidden = idle;
  tReset.hidden = !(s === 'running' || s === 'paused');
  tMain.textContent = { idle: 'Start', running: 'Pause', paused: 'Resume', done: 'Stop' }[s] || 'Start';
  tInput.value = T.min;
  clearInterval(tInt); tInt = null;
  if (s !== 'running') ringSent = false;
  if (s === 'running' && !document.hidden) tInt = setInterval(updateShow, 1000);
  updateShow();
}
async function setMin(n) {
  T.min = clampMin(n);
  tInput.value = T.min;
  await store.set({ timerMin: T.min });
}
async function startTimer() {
  const rem = T.st.status === 'paused' ? T.st.remaining : T.min * 60;
  const endTime = Date.now() + rem * 1000;
  await store.set({ timer: { status: 'running', endTime } });
  chrome.alarms.create('timer', { when: endTime });
}
async function pauseTimer() {
  const rem = remaining();
  await chrome.alarms.clear('timer');
  await store.set({ timer: { status: 'paused', remaining: rem } });
}
async function resetTimer() {
  await chrome.alarms.clear('timer');
  chrome.runtime.sendMessage({ type: 'stop-sound' });
  await store.set({ timer: { status: 'idle' } });
}
tMain.onclick = () => {
  const s = T.st.status;
  if (s === 'idle' || s === 'paused') startTimer();
  else if (s === 'running') pauseTimer();
  else resetTimer();
};
tReset.onclick = resetTimer;
tMinus.onclick = () => setMin(T.min - 5);
tPlus.onclick = () => setMin(T.min + 5);
tInput.onchange = () => setMin(+tInput.value);
tInput.onkeydown = e => { if (e.key === 'Enter') { setMin(+tInput.value); startTimer(); tInput.blur(); } };

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.timerMin) T.min = ch.timerMin.newValue || 25;
  if (ch.timer) T.st = ch.timer.newValue || { status: 'idle' };
  if (ch.timer || ch.timerMin) renderTimer();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { tickClock(); renderTimer(); }
  else { clearInterval(tInt); tInt = null; }
});

/* ───────── Boot ───────── */
tickClock();
loadBg();
loadMarks();
store.get(['timerMin', 'timer']).then(d => {
  T.min = d.timerMin || 25;
  T.st = d.timer || { status: 'idle' };
  renderTimer();
});
