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

/* ───────── Background (3 built-in wallpapers or the user's own image) ───────── */
const bg = $('bg');
const BGS = { green: 'backgrounds/green.jpg', night: 'backgrounds/night.jpg', sunset: 'backgrounds/sunset.jpg' };
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
async function downscale(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 2560 / bmp.width);
  const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
}
async function toneOf(blob) {                        // is the top half of the picture light or dark?
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(32, 18), x = c.getContext('2d');
  x.drawImage(bmp, 0, 0, 32, 18);
  bmp.close();
  const d = x.getImageData(0, 0, 32, 9).data;
  let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
  return s / n / 255 > 0.6 ? 'light' : 'dark';
}
/* ───────── Wallpaper palette: accent colour drives icon tint + Chrome theme ───────── */
const rgb2hsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60; }
  return [h, s, l];
};
const hsl2rgb = (h, s, l) => {
  const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
};
const toHex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const fromHex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
async function accentOf(url) {                       // most "colourful" hue in the picture
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const W = 48, H = 27, c = new OffscreenCanvas(W, H), x = c.getContext('2d');
  x.drawImage(bmp, 0, 0, W, H); bmp.close();
  const d = x.getImageData(0, 0, W, H).data;
  const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let R = 0, G = 0, B = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]; R += r; G += g; B += b; n++;
    const [h, s, l] = rgb2hsl(r, g, b);
    if (s < 0.15 || l < 0.12 || l > 0.9) continue;
    const w = s * (1 - Math.abs(2 * l - 1)), o = bins[Math.floor(h / 30) % 12];
    o.w += w; o.r += r * w; o.g += g * w; o.b += b * w;
  }
  const t = bins.reduce((a, b) => b.w > a.w ? b : a);
  return t.w > 0.5 ? [t.r, t.g, t.b].map(v => Math.round(v / t.w)) : [R, G, B].map(v => Math.round(v / n));
}
let acc = [60, 100, 70], pal = null, themeColor = null, marksLoaded = false, iconStyle = 'tint';
const lightUI = () => ['green', 'sunset', 'custom-light'].includes(document.body.dataset.bg);
function syncPalette() {
  const [h, s0] = rgb2hsl(...(themeColor ? fromHex(themeColor) : acc));
  const s = Math.min(0.75, Math.max(0.3, s0)), light = lightUI(), p = v => Math.round(v * 100);
  pal = light
    ? { bg1: `hsl(${h} ${p(s * .6)}% 94%)`, bg2: `hsl(${h} ${p(s * .55)}% 80%)`, fg: hsl2rgb(h, s, .2), lo: hsl2rgb(h, s * .5, .9) }
    : { bg1: `hsl(${h} ${p(s * .55)}% 32%)`, bg2: `hsl(${h} ${p(s * .6)}% 14%)`, fg: hsl2rgb(h, s * .9, .9), lo: hsl2rgb(h, s * .6, .2) };
  document.body.style.setProperty('--t1', pal.bg1);
  document.body.style.setProperty('--t2', pal.bg2);
  // Update Chrome tab strip colour via theme-color meta tag
  try {
    // 0.52 gives a mid-tone so Chrome's navigation buttons stay visible
    const [r,g,b] = acc.map(x => Math.round(Math.min(255, Math.max(0, x * 0.52))));
    let m = document.querySelector('meta[name=theme-color]');
    if (!m) { m = document.createElement('meta'); m.name='theme-color'; document.head.append(m); }
    m.content = `rgb(${r},${g},${b})`;
  } catch {}
  if (marksLoaded) renderMarks();
}
let customUrl = null;
function markThumbs(c) {
  document.querySelectorAll('#bgThumbs button').forEach(b => b.classList.toggle('sel', b.dataset.bg === c));
}
async function applyBg(choice, tone) {
  let url = null;
  if (choice === 'custom') {
    try {
      const blob = await idbGet('bg');
      if (blob) { if (customUrl) URL.revokeObjectURL(customUrl); url = customUrl = URL.createObjectURL(blob); }
    } catch {}
    if (!url) choice = 'green';
  }
  if (!url) url = BGS[choice] || BGS.green;
  document.body.dataset.bg = choice === 'custom' ? (tone === 'light' ? 'custom-light' : 'custom') : choice;
  // (thumbnail strip removed)
  try { acc = await accentOf(url); } catch {}
  syncPalette();
  try { const im = new Image(); im.src = url; await im.decode(); } catch {}
  bg.style.backgroundImage = `url(${url})`;
  bg.classList.add('ready');
}
async function loadBg() {
  const d = await store.get(['bgChoice', 'bgTone']);
  let c = d.bgChoice;
  if (!c) { try { c = (await idbGet('bg')) ? 'custom' : 'green'; } catch { c = 'green'; } }   // older installs
  await applyBg(c, d.bgTone);
}

/* ───────── Search + suggestions + recent searches ───────── */
const q = $('q'), sugg = $('sugg'), form = $('searchForm');
let items = [], sel = -1, typed = '', ctl, deb, recents = [], gList = [];
const MAX_RECENTS = 10, MAX_ITEMS = 8;
const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const saveRecents = () => store.set({ recents });
function addRecent(t) {
  const k = t.toLowerCase();
  recents = [t, ...recents.filter(r => r.toLowerCase() !== k)].slice(0, MAX_RECENTS);
  return saveRecents();
}

function looksLikeUrl(t) {
  if (/\s/.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?([\/?#]|$)/i.test(t)) return 'http://' + t;
  if (/^[^\s\/]+\.[a-z]{2,}(:\d+)?([\/?#].*)?$/i.test(t)) return 'https://' + t;
  return null;
}
async function go(text) {
  text = text.trim();
  if (!text) return;
  hideSugg();
  const u = looksLikeUrl(text);
  if (u) { location.href = u; return; }
  await addRecent(text);
  chrome.search.query({ text, disposition: 'CURRENT_TAB' });
}
function hideSugg() { sugg.hidden = true; items = []; sel = -1; }
function buildItems() {
  const t = typed.toLowerCase();
  const rec = (t ? recents.filter(r => r.toLowerCase().includes(t) && r.toLowerCase() !== t).slice(0, 3) : recents)
    .map(x => ({ t: x, r: true }));
  const seen = new Set(rec.map(x => x.t.toLowerCase()));
  const goo = gList.filter(s => !seen.has(s.toLowerCase())).map(x => ({ t: x }));
  return rec.concat(goo).slice(0, MAX_ITEMS);
}
function showSugg() {
  items = buildItems();
  if (!items.length) return hideSugg();
  const f = document.createDocumentFragment();
  const t = typed.toLowerCase();
  items.forEach((it, i) => {
    const li = document.createElement('li');
    li.dataset.i = i;
    li.insertAdjacentHTML('afterbegin', it.r ? ICON_CLOCK : ICON_SEARCH);
    const st = document.createElement('span'); st.className = 'st';
    if (!it.r && t && it.t.toLowerCase().startsWith(t)) {
      st.append(it.t.slice(0, t.length));
      const b = document.createElement('b'); b.textContent = it.t.slice(t.length);
      st.append(b);
    } else st.textContent = it.t;
    li.append(st);
    if (it.r) {
      const d = document.createElement('button');
      d.type = 'button'; d.className = 'del'; d.textContent = '×'; d.title = 'Remove from history';
      li.append(d);
    }
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
    gList = j[1] || [];
    showSugg();
  } catch {}
}
function mark() {
  [...sugg.children].forEach((li, i) => li.classList.toggle('on', i === sel));
}
function showRecentsIfEmpty() {
  const v = q.value.trim();
  if (!v) { typed = ''; gList = []; showSugg(); }
  else if (sugg.hidden) fetchSugg(v);
}
q.addEventListener('focus', showRecentsIfEmpty);
q.addEventListener('click', showRecentsIfEmpty);
q.addEventListener('input', () => {
  clearTimeout(deb);
  const v = q.value.trim();
  typed = v;
  if (!v) { ctl?.abort(); gList = []; showSugg(); return; }
  gList = gList.filter(s => s.toLowerCase().startsWith(v.toLowerCase()));   // drop stale results at once
  showSugg();
  deb = setTimeout(() => fetchSugg(v), 110);
});
q.addEventListener('keydown', e => {
  if (sugg.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = items.length;
    sel = e.key === 'ArrowDown' ? (sel + 1 >= n ? -1 : sel + 1) : (sel - 1 < -1 ? n - 1 : sel - 1);
    q.value = sel === -1 ? typed : items[sel].t;
    mark();
  } else if (e.key === 'Escape') hideSugg();
});
q.addEventListener('blur', () => setTimeout(hideSugg, 120));
sugg.addEventListener('mousedown', e => e.preventDefault());
sugg.addEventListener('click', e => {
  const li = e.target.closest('li');
  if (!li) return;
  const it = items[+li.dataset.i];
  if (e.target.closest('.del')) {               // remove one item from history
    recents = recents.filter(r => r !== it.t);
    saveRecents();
    showSugg();
    return;
  }
  go(it.t);
});
form.addEventListener('submit', e => { e.preventDefault(); go(q.value); });

/* ───────── Shortcuts ───────── */
const icons = $('icons'), dock = $('dock');
// Version 3: no preloaded shortcuts. Earlier starter sets are cleared automatically if the user never changed them.
const OLD_SETS = [['YouTube', 'Gmail', 'GitHub'], ['YouTube', 'Instagram', 'Facebook', 'Claude']];
const MARKS_V = 3;
let marks = [];
const favicon = u => `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(u)}&size=128`;
const saveMarks = () => store.set({ marks, marksV: MARKS_V });

/* macOS-style icon tiles: colour each tile from the site's own icon */
const cv = document.createElement('canvas'); cv.width = cv.height = 32;
const cx = cv.getContext('2d', { willReadFrequently: true });
function analyse(img) {
  cx.clearRect(0, 0, 32, 32);
  cx.drawImage(img, 0, 0, 32, 32);
  const d = cx.getImageData(0, 0, 32, 32).data;
  let n = 0, lum = 0, val = 0, sat = 0, hx = 0, hy = 0, w = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    n++; lum += 0.2126 * r + 0.7152 * g + 0.0722 * b; val += mx;
    const s = mx ? c / mx : 0; sat += s;
    if (c > 0.08) {
      const h = (mx === r ? ((g - b) / c + 6) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4) * Math.PI / 3;
      const wt = s * mx;
      hx += Math.cos(h) * wt; hy += Math.sin(h) * wt; w += wt;
    }
  }
  if (!n) return null;
  return { cover: n / 1024, lum: lum / n, val: val / n, sat: sat / n, hue: (Math.atan2(hy, hx) * 180 / Math.PI + 360) % 360, coh: w ? Math.hypot(hx, hy) / w : 0 };
}
function styleTile(t, img) {
  try {
    const a = analyse(img);
    if (!a) return;
    if (a.cover > 0.9) t.classList.add('bleed');                                   // icon already fills the square
    else if (a.lum < 0.2 || a.val < 0.42) return;                                  // dark glyph: keep the light tile
    else if (a.sat < 0.2 || a.coh < 0.45) t.style.background = 'linear-gradient(160deg,#4a4b53,#17171b)';   // white / multicolour glyph
    else { const h = Math.round(a.hue); t.style.background = `linear-gradient(160deg,hsl(${h} 58% 33%),hsl(${h} 64% 13%))`; }
  } catch {}
}

/* high-resolution icons: Google's favicon service (up to 256 px), cached; Chrome's own favicon is the fallback */
const iconMem = new Map();
const gUrl = u => `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&nfrp=2&size=256&url=${encodeURIComponent(new URL(u).origin)}`;
function getIcon(u) {
  const key = 'icon:' + new URL(u).origin;
  if (!iconMem.has(key)) iconMem.set(key, (async () => {
    try { const b = await idbGet(key); if (b) return b; } catch {}
    let best = null, bw = 0, fromG = false;
    for (const [src, g] of [[gUrl(u), true], [favicon(u), false]]) {
      try {
        const r = await fetch(src); if (!r.ok) continue;
        const b = await r.blob(); if (!b.type.startsWith('image/')) continue;
        const bm = await createImageBitmap(b), w = bm.width; bm.close();
        if (w > bw) { best = b; bw = w; fromG = g; }
        if (w >= 64) break;
      } catch {}
    }
    if (best && fromG) idbSet(key, best).catch(() => {});
    return best;
  })());
  return iconMem.get(key);
}
function glyph(bmp, a, style) {                        // monochrome / duotone version of the icon, in the wallpaper's colours
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true });
  const mask = a.cover < 0.6, f = a.cover > 0.9 ? 1 : a.cover > 0.6 ? 0.78 : 0.58;
  const k = Math.min(S * f / bmp.width, S * f / bmp.height), w = bmp.width * k, h = bmp.height * k;
  x.imageSmoothingQuality = 'high';
  x.drawImage(bmp, (S - w) / 2, (S - h) / 2, w, h);
  const im = x.getImageData(0, 0, S, S), d = im.data;
  const fg = style === 'glass' ? [255, 255, 255] : pal.fg, lo = pal.lo;
  const L = i => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  if (mask) {                                          // glyph on transparent background → solid tinted glyph
    for (let i = 0; i < d.length; i += 4) { d[i] = fg[0]; d[i + 1] = fg[1]; d[i + 2] = fg[2]; }
  } else {                                             // filled icon → keep its detail as light/dark steps
    let mn = 1, mx = 0, sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { const l = L(i); mn = Math.min(mn, l); mx = Math.max(mx, l); sum += l; n++; }
    const inv = n && sum / n > 0.6, span = Math.max(0.15, mx - mn);
    for (let i = 0; i < d.length; i += 4) {
      let l = Math.min(1, Math.max(0, (L(i) - mn) / span)); if (inv) l = 1 - l;
      if (style === 'glass') { d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(d[i + 3] * (0.15 + 0.85 * l)); }
      else { d[i] = lo[0] + (fg[0] - lo[0]) * l; d[i + 1] = lo[1] + (fg[1] - lo[1]) * l; d[i + 2] = lo[2] + (fg[2] - lo[2]) * l; }
    }
  }
  x.putImageData(im, 0, 0);
  return c;
}
async function fillTile(t, url, style) {
  try {
    const blob = await getIcon(url);
    if (!blob) return;
    if (style === 'original') {
      const img = new Image(); img.alt = ''; img.draggable = false;
      img.onload = () => { styleTile(t, img); URL.revokeObjectURL(img.src); };
      img.src = URL.createObjectURL(blob); t.prepend(img);
      return;
    }
    const bmp = await createImageBitmap(blob), a = analyse(bmp);
    if (a) { if (a.cover > 0.9 && style === 'tint') t.classList.add('full'); t.prepend(glyph(bmp, a, style)); }
    bmp.close();
  } catch {}
}
function renderMarks() {
  const f = document.createDocumentFragment();
  for (const m of marks) {
    const a = document.createElement('a');
    a.className = 'app'; a.href = m.url; a.dataset.id = m.id; a.draggable = false;
    const t = document.createElement('span'); t.className = 'tile' + (iconStyle === 'original' ? '' : ' ' + iconStyle);
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; x.title = 'Remove';
    t.append(x); fillTile(t, m.url, iconStyle);
    const l = document.createElement('span'); l.className = 'lbl'; l.textContent = m.name;
    a.append(t, l); f.append(a);
  }
  const empty = !marks.length;
  const add = document.createElement('button');
  add.className = 'app add' + (empty ? ' empty' : ''); add.id = 'addBtn'; add.type = 'button';
  const at = document.createElement('span'); at.className = 'tile'; at.textContent = '+';
  if (empty) {
    const hint = document.createElement('span'); hint.className = 'hint';
    const hb = document.createElement('b'); hb.textContent = 'Add shortcuts here';
    const hs = document.createElement('span'); hs.textContent = 'Your favourite sites, one click away';
    hint.append(hb, hs);
    add.append(at, hint);
  } else {
    const al = document.createElement('span'); al.className = 'lbl'; al.textContent = 'Add';
    add.append(at, al);
  }
  f.append(add);
  icons.replaceChildren(f);
}
async function loadMarks() {
  const d = await store.get(['marks', 'marksV', 'iconStyle', 'themeColor']);
  const m = d.marks;
  iconStyle = 'glass';
  if (d.themeColor) themeColor = d.themeColor;
    const same = (a, names) => a.length === names.length && a.every((x, i) => x.name === names[i]);
  const untouchedOld = Array.isArray(m) && OLD_SETS.some(s => same(m, s));
  if (!Array.isArray(m) || ((d.marksV || 1) < MARKS_V && untouchedOld)) { marks = []; saveMarks(); }
  else { marks = m; if (d.marksV !== MARKS_V) saveMarks(); }
  marksLoaded = true;
  renderMarks();
  syncPalette();
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
function removeMark(id) { marks = marks.filter(m => m.id !== id); saveMarks(); renderMarks(); }

/* shared top bar for both edit modes */
const bar = $('editbar'), barMsg = $('editMsg'), layoutReset = $('layoutReset');
function showBar(msg, withReset) { barMsg.textContent = msg; layoutReset.hidden = !withReset; bar.hidden = false; }

/* hold 3 s on a shortcut → wiggle mode: drag to reorder, tap to edit, × to remove */
const HOLD_MS = 3000;
let wiggle = false, down = null, holdT = 0, drag = null, ignoreClick = false;
function enterWiggle() {
  if (wiggle) return;
  exitLayout();
  wiggle = true;
  dock.classList.add('wiggle');
  showBar('Drag to reorder · tap an icon to edit', false);
}
function exitWiggle() {
  if (!wiggle) return;
  wiggle = false;
  dock.classList.remove('wiggle');
  bar.hidden = true;
}
function cancelHold() {
  clearTimeout(holdT);
  down?.a.classList.remove('holding');
}
icons.addEventListener('dragstart', e => e.preventDefault());
icons.addEventListener('pointerdown', e => {
  if (e.button !== 0 || down) return;
  const a = e.target.closest('a.app[data-id]');
  if (!a || e.target.closest('.x')) return;
  down = { a, x: e.clientX, y: e.clientY };
  if (!wiggle) {
    a.classList.add('holding');
    holdT = setTimeout(() => { a.classList.remove('holding'); ignoreClick = true; enterWiggle(); }, HOLD_MS);
  }
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
});
function onMove(e) {
  if (!down) return;
  if (drag) return moveDrag(e);
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > (wiggle ? 6 : 10)) {
    if (wiggle) startDrag(e);
    else { cancelHold(); down = { ...down, dead: true }; }
  }
}
function onUp() {
  removeEventListener('pointermove', onMove);
  removeEventListener('pointerup', onUp);
  removeEventListener('pointercancel', onUp);
  cancelHold();
  if (drag) endDrag();
  down = null;
  setTimeout(() => { ignoreClick = false; }, 250);
}
function startDrag(e) {
  const a = down.a, r = a.getBoundingClientRect();
  drag = { a, ox: e.clientX - r.left, oy: e.clientY - r.top, lock: 0 };
  ignoreClick = true;
  a.classList.add('dragging');
  moveDrag(e);
}
function moveDrag(e) {
  const a = drag.a;
  a.style.transform = 'none';
  if (performance.now() > drag.lock) {
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('a.app[data-id]');
    if (t && t !== a) {
      const sibs = [...icons.querySelectorAll('a.app[data-id]')].filter(n => n !== a);
      const before = new Map(sibs.map(n => [n, n.getBoundingClientRect()]));
      const forward = a.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING;
      t.parentNode.insertBefore(a, forward ? t.nextSibling : t);
      for (const n of sibs) {
        const b = before.get(n), c = n.getBoundingClientRect();
        const dx = b.left - c.left, dy = b.top - c.top;
        if (dx || dy) n.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      drag.lock = performance.now() + 240;
    }
  }
  const r = a.getBoundingClientRect();
  a.style.transform = `translate(${e.clientX - drag.ox - r.left}px,${e.clientY - drag.oy - r.top}px)`;
}
function endDrag() {
  const a = drag.a, r0 = a.getBoundingClientRect();
  a.style.transform = 'none';
  a.classList.remove('dragging');
  const r1 = a.getBoundingClientRect();
  a.animate([{ transform: `translate(${r0.left - r1.left}px,${r0.top - r1.top}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  const order = [...icons.querySelectorAll('a.app[data-id]')].map(n => n.dataset.id);
  marks = order.map(id => marks.find(m => m.id === id)).filter(Boolean);
  saveMarks();
  drag = null;
}
icons.addEventListener('click', e => {
  if (e.target.closest('#addBtn')) return openDlg();
  const a = e.target.closest('a.app[data-id]');
  if (!a) return;
  if (ignoreClick) { e.preventDefault(); return; }
  if (wiggle) {
    e.preventDefault();
    if (e.target.closest('.x')) removeMark(a.dataset.id);
    else openDlg(marks.find(m => m.id === a.dataset.id));
  }
});

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
  if (act === 'del') removeMark(ctxId);
  ctx.hidden = true;
});

/* ───────── Layout: move + resize clock, timer, search, shortcuts ───────── */
const KEYS = ['clock', 'timer', 'search', 'dock'];
const blocks = {};
document.querySelectorAll('.blk').forEach(b => {
  blocks[b.dataset.k] = b;
  const h = document.createElement('span'); h.className = 'rh'; h.title = 'Drag to resize';
  b.append(h);
});
let layout = {}, editing = false;
const SNAP = 8, gV = $('guideV'), gH = $('guideH');
function snap(vals, targets) {
  let best = null;
  for (const v of vals) for (const t of targets) {
    const d = t - v, w = Math.abs(d) - (t === targets[0] ? 6 : 0);   // screen centre wins close calls
    if (Math.abs(d) <= SNAP && (!best || w < best.w)) best = { d, t, w };
  }
  return best;
}
function showGuides(x, y) {
  gV.hidden = x === null; if (x !== null) gV.style.left = x + 'px';
  gH.hidden = y === null; if (y !== null) gH.style.top = y + 'px';
}
function hideGuides() { gV.hidden = true; gH.hidden = true; }
function setBlock(k, v) {
  const b = blocks[k];
  b.style.setProperty('--x', v.x); b.style.setProperty('--y', v.y); b.style.setProperty('--s', v.s);
}
function applyLayout() {
  for (const k of KEYS) setBlock(k, { x: 0, y: 0, s: 1, ...(layout[k] || {}) });
}
async function loadLayout() {
  const d = await store.get('layout');
  layout = d.layout || {};
  applyLayout();
}
function enterLayout() {
  exitWiggle();
  editing = true;
  document.body.classList.add('editing');
  hideSugg();
  showBar('Drag a box to move it · drag the dot to resize', true);
}
function exitLayout() {
  if (!editing) return;
  editing = false;
  hideGuides();
  document.body.classList.remove('editing');
  bar.hidden = true;
}
for (const k of KEYS) {
  blocks[k].addEventListener('pointerdown', e => {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    const b = blocks[k];
    const v = { x: 0, y: 0, s: 1, ...(layout[k] || {}) };
    const resize = e.target.classList.contains('rh');
    const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
    const sx = e.clientX, sy = e.clientY;
    let last = v;
    const others = KEYS.filter(o => o !== k).map(o => blocks[o].getBoundingClientRect());
    const xT = [innerWidth / 2, ...others.flatMap(o => [o.left, o.left + o.width / 2, o.right])];
    const yT = [innerHeight / 2, ...others.flatMap(o => [o.top, o.top + o.height / 2, o.bottom])];
    const mv = ev => {
      const n = { ...v };
      if (resize) n.s = Math.min(2.5, Math.max(0.5, v.s * Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0));
      else {
        let dx = ev.clientX - sx, dy = ev.clientY - sy, gx = null, gy = null;
        if (!ev.altKey) {                                  // hold Alt to move without snapping
          const L = r.left + dx, T = r.top + dy;
          const bx = snap([L, L + r.width / 2, L + r.width], xT);
          const by = snap([T, T + r.height / 2, T + r.height], yT);
          if (bx) { dx += bx.d; gx = bx.t; }
          if (by) { dy += by.d; gy = by.t; }
        }
        n.x = v.x + dx / innerWidth * 100; n.y = v.y + dy / innerHeight * 100;
        showGuides(gx, gy);
      }
      setBlock(k, n);
      const rr = b.getBoundingClientRect();           // keep at least a corner on screen
      if (rr.right < 60 || rr.left > innerWidth - 60 || rr.bottom < 60 || rr.top > innerHeight - 60) { setBlock(k, last); return; }
      last = n;
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      layout[k] = last;
      store.set({ layout });
      hideGuides();
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}
layoutReset.onclick = () => { layout = {}; store.set({ layout }); applyLayout(); };
$('editDone').onclick = () => { exitLayout(); exitWiggle(); };

/* ───────── Settings ───────── */
const settings = $('settings');
$('gear').onclick = e => { e.stopPropagation(); settings.hidden = !settings.hidden; };
$('editLayout').onclick = () => { settings.hidden = true; enterLayout(); };
$('bgDefault').onclick = async () => {
  try { await idbSet('bg', undefined); } catch {}
  await store.set({ bgChoice: 'green' });
  await applyBg('green');
  settings.hidden = true;
};
$('bgPick').onclick = () => $('bgFile').click();
$('bgFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const blob = await downscale(file);
    const tone = await toneOf(blob);
    await idbSet('bg', blob);
    await store.set({ bgChoice: 'custom', bgTone: tone });
    await applyBg('custom', tone);
  } catch {}
  settings.hidden = true;
  e.target.value = '';
};

/* Chrome can't change its own theme from an extension, so we write the colours into the meadow-theme folder
   (you pick it once); then you press ↻ on that theme in chrome://extensions. */
const themeMsg = $('themeMsg'), say = t => { themeMsg.textContent = t; themeMsg.hidden = false; };
function themeColors() {
  const src = themeColor ? fromHex(themeColor) : acc, [h, s0] = rgb2hsl(...src);
  const light = themeColor ? rgb2hsl(...src)[2] > 0.6 : lightUI();
  const s = Math.min(0.55, Math.max(0.2, s0 * 0.8)), c = (l, sd = s) => hsl2rgb(h, sd, l);
  return light
    ? { frame: c(.82), frame_inactive: c(.88), toolbar: c(.94), tab_text: [24, 24, 28], tab_background_text: c(.25, .4),
        bookmark_text: [24, 24, 28], omnibox_background: c(.98), omnibox_text: [24, 24, 28], button_background: c(.94) }
    : { frame: c(.13), frame_inactive: c(.17), toolbar: c(.22), tab_text: [255, 255, 255], tab_background_text: c(.8, .3),
        bookmark_text: [255, 255, 255], omnibox_background: c(.16), omnibox_text: [255, 255, 255], button_background: c(.22) };
}
async function readThemeManifest(dir) {
  try { const m = JSON.parse(await (await (await dir.getFileHandle('manifest.json')).getFile()).text()); return m.theme ? m : null; } catch { return null; }
}
async function applyChromeTheme() {
  if (!window.showDirectoryPicker) return say('This browser cannot save to a folder.');
  let dir = null, m = null;
  try {
    dir = await idbGet('themeDir');
    if (dir && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') dir = null;
    if (dir) m = await readThemeManifest(dir);
    if (!m) { dir = await showDirectoryPicker({ id: 'meadow-theme', mode: 'readwrite' }); m = await readThemeManifest(dir); }
    if (!m) return say('That is not the theme folder. Choose the "meadow-theme" folder (the one with the theme manifest.json).');
    await idbSet('themeDir', dir);
    m.theme.colors = themeColors();
    const w = await (await dir.getFileHandle('manifest.json')).createWritable();
    await w.write(JSON.stringify(m, null, 2)); await w.close();
    say('Saved. In the Extensions page that just opened, press ↻ on "Meadow Frame Theme".');
    try { chrome.tabs.create({ url: 'chrome://extensions' }); } catch {}
  } catch (e) { if (e.name !== 'AbortError') say('Could not save: ' + e.message); }
}
document.addEventListener('click', e => {
  if (!settings.contains(e.target)) settings.hidden = true;
  ctx.hidden = true;
  if (wiggle && !ignoreClick) {
    // composedPath survives the target being removed from the DOM (e.g. after deleting an icon)
    const inside = e.composedPath().some(n => n.id === 'dock' || n.id === 'editbar' || n.tagName === 'DIALOG');
    if (!inside) exitWiggle();
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  settings.hidden = true; ctx.hidden = true;
  if (!dlg.open) { exitLayout(); exitWiggle(); }
});

/* ───────── Focus timer (Pomodoro: focus → 5-min break auto-cycle) ───────── */
const T = { min: 25, breakMin: 5, st: { status: 'idle', phase: 'focus' } };
const tInput = $('tInput'), tShow = $('tShow'), tEdit = $('tEdit'), tMain = $('tMain'), tReset = $('tReset');
const tMinus = $('tMinus'), tPlus = $('tPlus'), tBox = $('timer'), tPhase = $('tPhase');
let tInt = null, ringSent = false;
const clampMin = n => Math.min(180, Math.max(1, Math.round(n) || 25));
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function remaining() {
  const { status, endTime, remaining: r } = T.st;
  if (status === 'running') return Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  if (status === 'paused') return r;
  if (status === 'done') return 0;
  return (T.st.phase === 'break' ? T.breakMin : T.min) * 60;
}
function updateShow() {
  const s = remaining(), st = T.st.status, ph = T.st.phase || 'focus';
  tShow.textContent = st === 'done' ? (ph === 'break' ? 'Break over!' : "Time's up") : fmt(s);
  document.title = st === 'running' ? `${fmt(s)} · ${ph === 'break' ? 'Break ☕' : 'Focus 🎯'}` : 'New Tab';
  if (st === 'running' && s <= 0 && !ringSent) {
    ringSent = true;
    chrome.runtime.sendMessage({ type: 'ring' });
  }
}
function renderTimer() {
  const s = T.st.status, ph = T.st.phase || 'focus', idle = s === 'idle';
  tBox.dataset.state = s; tBox.dataset.phase = ph;
  tPhase.hidden = idle;
  tPhase.textContent = ph === 'break' ? '☕ Break' : '🎯 Focus';
  tEdit.hidden = !idle; tMinus.hidden = !idle; tPlus.hidden = !idle;
  tShow.hidden = idle;
  tReset.hidden = !(s === 'running' || s === 'paused' || s === 'done');
  tMain.textContent = { idle: 'Start', running: 'Pause', paused: 'Resume',
    done: ph === 'break' ? 'Skip break' : 'Start break ☕' }[s] || 'Start';
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
async function startTimer(phase) {
  const ph = phase || T.st.phase || 'focus';
  const mins = ph === 'break' ? T.breakMin : T.min;
  const rem = (!phase && T.st.status === 'paused') ? T.st.remaining : mins * 60;
  const endTime = Date.now() + rem * 1000;
  await store.set({ timer: { status: 'running', phase: ph, endTime } });
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
  const s = T.st.status, ph = T.st.phase || 'focus';
  if (s === 'idle' || s === 'paused') startTimer();
  else if (s === 'running') pauseTimer();
  else {
    if (ph === 'focus') startTimer('break');   // "Start break ☕"
    else resetTimer();                          // "Skip break" → back to idle
  }
};
tReset.onclick = resetTimer;
tMinus.onclick = () => setMin(T.min - 5);
tPlus.onclick = () => setMin(T.min + 5);
tInput.onchange = () => setMin(+tInput.value);
tInput.onkeydown = e => { if (e.key === 'Enter') { setMin(+tInput.value); startTimer(); tInput.blur(); } };

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.timerMin) T.min = ch.timerMin.newValue || 25;
  if (ch.timer) T.st = ch.timer.newValue || { status: 'idle', phase: 'focus' };
  if (ch.timer || ch.timerMin) renderTimer();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { tickClock(); renderTimer(); }
  else { clearInterval(tInt); tInt = null; }
});

/* ───────── Boot ───────── */
tickClock();
const loadTimer = () => store.get(['timerMin', 'timer']).then(d => {
  T.min = d.timerMin || 25;
  T.st = d.timer || { status: 'idle' };
  renderTimer();
});
const loadRecents = () => store.get('recents').then(d => { recents = d.recents || []; });
Promise.allSettled([loadBg(), loadMarks(), loadLayout(), loadTimer(), loadRecents()]).then(() => document.body.classList.add('ready'));
setTimeout(() => document.body.classList.add('ready'), 700);   // never stay hidden
