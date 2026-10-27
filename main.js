/* ==========================================================
   CONFIG — 換音樂時只要改這裡
   ========================================================== */
const CONFIG = {
  // 兩個風格各一首背景音樂；檔案還沒放進 assets/ 時不會出錯，只是沒有聲音
  bgm: {
    meadow: 'assets/bgm-meadow.mp3',
    ice: 'assets/bgm-ice.mp3',
  },
  bgmVolume: 0.3,      // 預設音量（0–1）；用音量拉桿調過後會記在瀏覽器
  bgmFadeInMs: 1800,
  bgmFadeOutMs: 700,
  navLockMs: 520,      // 翻卡防連點

  // 背景粒子（數字越大越熱鬧）
  floatDensity: 1 / 28000, // 草木的花瓣、嫩葉、光點：每 px² 幾個（1920×1080 約 74 個）
  snowDensity: 1 / 9000,   // 雪花（約 230 片）
  starCount: 140,
};

const TEXT = {
  meadow: { title: '苒苒 生日快樂', end: ['苒苒，', '生日快樂！'] },
  ice: { title: '冰雪姬大人 生日快樂', end: ['冰雪姬大人，', '生日快樂！'] },
};
const ANON = '匿名的苒寶';

/* ==========================================================
   State
   ========================================================== */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const state = {
  theme: 'meadow',
  phase: 'empty',   // empty：還沒導入 / ready：有問卷、信箱關著 / open：正在看卡片
  letters: [],      // 隨機排序後的問卷
  labels: ['怎麼稱呼', '是從什麼時候開始看苒苒的', '想對苒苒說些什麼呢'],
  index: 0,         // letters.length 代表結尾卡片
  card: null,       // 目前顯示的卡片元素
  busy: false,
  musicOn: true,
};

const $ = (id) => document.getElementById(id);
const els = {
  root: document.documentElement,
  stage: $('stage'),
  greetTitle: $('greetTitle'),
  hint: $('hint'),
  mailbox: $('mailbox'),
  door: $('door'),
  doorFrame: $('doorFrame'),
  importBtn: $('importBtn'),
  importLabel: $('importLabel'),
  fileInput: $('fileInput'),
  viewer: $('viewer'),
  cardSlot: $('cardSlot'),
  prev: $('prevBtn'),
  next: $('nextBtn'),
  counter: $('counter'),
  dropHint: $('dropHint'),
  musicCtrl: $('musicCtrl'),
  musicToggle: $('musicToggle'),
  volumeBtn: $('volumeBtn'),
  volumePop: $('volumePop'),
  volumeSlider: $('volumeSlider'),
  volumeNum: $('volumeNum'),
  bgm: $('bgm'),
  themeBtns: [...document.querySelectorAll('.theme-btn')],
  canvas: $('particles'),
  bgMeadow: $('bgMeadow'),
  bgIce: $('bgIce'),
  front: $('front'),
  vineLeaves: $('vineLeaves'),
};

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function rand(a, b) { return a + Math.random() * (b - a); }
function unit() { return Math.min(innerWidth / 100, innerHeight / 56.25); } // = CSS 的 --u（px）

/* ==========================================================
   CSV：讀檔、解析、過濾測試回覆、隨機排序
   ========================================================== */
async function readCsvFile(file) {
  const buf = await file.arrayBuffer();
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    text = new TextDecoder('big5').decode(buf); // Excel 另存的中文 CSV 常是 Big5
  }
  return text.replace(/^﻿/, '');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

// 題目文字：拿掉「(怎樣的稱呼都可以!也可以匿名!)」這種較長的括號補充說明
function cleanLabel(s) {
  return s.replace(/[（(][^）)]{5,}[）)]/g, '').trim();
}

// 找出三題的欄位：用關鍵字找，找不到就依序取時間戳記以外的欄位
function pickColumns(header) {
  const find = (re, taken) => header.findIndex((h, i) => !taken.includes(i) && re.test(h));
  const taken = [];
  const name = find(/稱呼|名字|暱稱|名稱/, taken); if (name >= 0) taken.push(name);
  const words = find(/說/, taken); if (words >= 0) taken.push(words);
  const since = find(/什麼時候|開始|類型/, taken); if (since >= 0) taken.push(since);
  const rest = header.map((h, i) => i).filter((i) => !taken.includes(i) && !/時間|timestamp/i.test(header[i]));
  const cols = [name, since, words].map((c) => (c >= 0 ? c : rest.shift() ?? -1));
  return cols;
}

function extractLetters(rows) {
  if (rows.length < 2) throw new Error('這個檔案裡沒有問卷回覆');
  const header = rows[0].map((h) => h.trim());
  const cols = pickColumns(header);
  if (cols.filter((c) => c >= 0).length < 2) throw new Error('看不懂這個檔案的欄位，請確認是問卷匯出的 CSV');
  const labels = cols.map((c, i) => (c >= 0 ? cleanLabel(header[c]) : state.labels[i]));
  // 每一份回覆都保留（連測試的 rrrrr 也是一種效果）
  const letters = rows.slice(1).map((r) => {
    const [name, since, words] = cols.map((c) => (c >= 0 ? (r[c] ?? '').trim() : ''));
    return { name, since, words };
  });
  return { labels, letters };
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

async function importFile(file) {
  if (!file || state.phase === 'open' || state.busy) return;
  try {
    const { labels, letters } = extractLetters(parseCsv(await readCsvFile(file)));
    state.labels = labels;
    state.letters = shuffle(letters);
    state.index = 0;
    setHint('大家的祝福都投進這個信箱了');
    els.importLabel.textContent = '重新導入';
    await dropLettersIntoSlot(Math.min(5, letters.length));
    state.phase = 'ready';
    els.mailbox.dataset.state = 'ready';
  } catch (err) {
    setHint(err.message || '讀不了這個檔案', true);
  }
}

function setHint(text, isError = false) {
  els.hint.textContent = text;
  els.hint.classList.toggle('is-error', isError);
}

/* ==========================================================
   信箱：導入動畫、打開、關上
   ========================================================== */
els.importBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  els.fileInput.click();
});
els.fileInput.addEventListener('change', () => {
  const file = els.fileInput.files[0];
  els.fileInput.value = ''; // 同一個檔案再選一次也要觸發
  importFile(file);
});

// 拖曳 CSV 到畫面上任何地方也能導入
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || state.phase === 'open') return;
  dragDepth++;
  els.dropHint.hidden = false;
});
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) els.dropHint.hidden = true;
});
document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  els.dropHint.hidden = true;
  importFile(e.dataTransfer.files[0]);
});

function slotRect() { return els.mailbox.querySelector('.mb-slot').getBoundingClientRect(); }

async function dropLettersIntoSlot(n) {
  if (reduceMotion.matches) return;
  const slot = slotRect();
  const anims = [];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'drop-letter';
    document.body.appendChild(el);
    const w = el.offsetWidth;
    const x = slot.left + slot.width / 2 - w / 2;
    const y = slot.top - w * 0.5;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    const fromX = rand(-1, 1) * unit() * 10;
    const a = el.animate([
      { transform: `translate(${fromX}px, ${-unit() * 22}px) rotate(${rand(-30, 30)}deg)`, opacity: 0 },
      { opacity: 1, offset: 0.2 },
      { transform: 'translate(0, 0) rotate(0deg)', opacity: 1, offset: 0.75 },
      { transform: `translate(0, ${w * 0.45}px) scaleY(0.2)`, opacity: 0 },
    ], { duration: 900, delay: i * 140, easing: 'cubic-bezier(0.3, 0.6, 0.4, 1)', fill: 'backwards' });
    anims.push(a.finished.then(() => el.remove()));
  }
  await Promise.all(anims);
}

els.mailbox.addEventListener('click', (e) => {
  if (e.target.closest('.mb-import')) return;
  if (state.phase === 'ready') openMailbox();
  else if (state.phase === 'empty') {
    setHint('先按「導入問卷」，把問卷 CSV 放進信箱');
    els.importBtn.animate([{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.12)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 420, easing: 'ease-out' });
  }
});

async function openMailbox() {
  if (state.busy) return;
  state.busy = true;
  state.phase = 'open';
  state.index = 0;
  els.mailbox.dataset.state = 'open';
  els.door.setAttribute('aria-label', '信箱已打開');
  const motion = !reduceMotion.matches;
  if (motion) {
    await wait(450);
    puffSheets(7);
    await wait(500);
  }
  els.stage.classList.add('is-open');
  if (motion) await wait(650);
  els.viewer.hidden = false;
  await showCard(0, 'enter');
  state.busy = false;
  els.next.focus({ preventScroll: true });
}

async function closeMailbox() {
  if (state.busy) return;
  state.busy = true;
  const card = state.card;
  state.card = null;
  if (card) await animateOut(card, 'return').catch(() => {});
  els.cardSlot.replaceChildren();
  els.viewer.hidden = true;
  els.stage.classList.remove('is-open');
  if (!reduceMotion.matches) await wait(900);
  state.phase = 'ready';
  els.mailbox.dataset.state = 'ready';
  els.door.setAttribute('aria-label', '打開信箱');
  state.busy = false;
  els.door.focus({ preventScroll: true });
}

// 打開時從信箱飄出來的小紙片
function puffSheets(n) {
  const d = els.doorFrame.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'mini-sheet';
    document.body.appendChild(el);
    el.style.left = `${d.left + d.width / 2 - el.offsetWidth / 2}px`;
    el.style.top = `${d.top + d.height / 2 - el.offsetHeight / 2}px`;
    const u = unit();
    const dx = rand(-1, 1) * u * 30 + u * 6;
    const dy = -rand(14, 34) * u;
    el.animate([
      { transform: 'translate(0, 0) scale(0.3) rotate(0deg)', opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.7}px) scale(1) rotate(${rand(-40, 40)}deg)`, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.9) rotate(${rand(-120, 120)}deg)`, opacity: 0 },
    ], { duration: rand(1500, 2200), delay: i * 70, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'backwards' })
      .finished.then(() => el.remove());
  }
}

/* ==========================================================
   卡片
   ========================================================== */
const DECO_SVG = '<svg class="card-deco" viewBox="0 0 60 60" aria-hidden="true">'
  + '<g class="sprout"><path class="stem" d="M30 54 C 30 44, 30 36, 30 28"/>'
  + '<path d="M30 34 C 18 36, 8 28, 6 16 C 18 14, 28 22, 30 34 Z"/>'
  + '<path class="light" d="M30 28 C 34 16, 44 8, 56 8 C 54 22, 44 30, 30 28 Z"/></g>'
  + '<g class="snowflake"><path d="M30 6v48M9.2 18l41.6 24M9.2 42l41.6-24M24 9l6 6 6-6M24 51l6-6 6 6M9 25l8 1.5-3 7.5M51 35l-8-1.5 3-7.5M9 35l8-1.5-3-7.5M51 25l-8 1.5 3 7.5"/></g>'
  + '</svg>';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function question(label, answer, cls, answerCls) {
  const q = el('div', `q ${cls || ''}`);
  q.append(el('p', 'q-label', label));
  const a = el('p', answerCls, answer || '（沒有填）');
  if (!answer) a.classList.add('is-empty');
  q.append(a);
  return q;
}

function fillEndTitle(h) {
  h.replaceChildren(...TEXT[state.theme].end.map((line) => el('span', 'hl', line)));
}

function buildCard(i) {
  const card = el('article', 'card');
  card.insertAdjacentHTML('afterbegin', DECO_SVG);
  const body = el('div', 'card-body');
  if (i >= state.letters.length) {
    card.classList.add('card-end');
    const count = el('p', 'end-count');
    count.append('以上是 ', el('b', '', String(state.letters.length)), ' 位苒寶的祝福');
    const title = el('h2', 'end-title');
    fillEndTitle(title);
    const back = el('button', 'end-back', '回到信箱');
    back.type = 'button';
    back.addEventListener('click', closeMailbox);
    body.append(count, title, back);
  } else {
    const L = state.letters[i];
    const [l1, l2, l3] = state.labels;
    const name = question(l1, L.name || ANON, 'q-name', 'q-name-text');
    if (!L.name) name.querySelector('.q-name-text').classList.add('is-anon');
    body.append(name, question(l2, L.since, '', 'q-answer'), question(l3, L.words, 'q-main', 'q-answer'));

    const remove = el('button', 'card-remove', '移除這張');
    remove.type = 'button';
    remove.setAttribute('aria-label', '從這次播放中移除這張問卷');
    remove.addEventListener('click', () => onRemove(remove));
    card.append(remove);
  }
  card.append(body);
  return card;
}

// 字太多時整張卡的字一起縮小，縮到 0.6 倍還放不下才捲動
function fitCard(card) {
  const body = card.querySelector('.card-body');
  let fit = 1;
  body.style.setProperty('--fit', '1');
  while (body.scrollHeight > body.clientHeight + 1 && fit > 0.6) {
    fit = Math.round((fit - 0.05) * 100) / 100;
    body.style.setProperty('--fit', String(fit));
  }
}

function doorCenter() {
  const d = els.doorFrame.getBoundingClientRect();
  return { x: d.left + d.width / 2, y: d.top + d.height / 2, w: d.width };
}

// 卡片從信箱飄出來 / 回到信箱（用同一組座標）
// 用卡片槽的位置計算（卡片本身可能正在動畫中）
function mailboxKeyframes() {
  const r = els.cardSlot.getBoundingClientRect();
  const d = doorCenter();
  const dx = d.x - (r.left + r.width / 2);
  const dy = d.y - (r.top + r.height / 2);
  const s = Math.max(0.06, d.w / r.width);
  return [
    { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(-14deg)`, opacity: 0 },
    { opacity: 1, offset: 0.2 },
    { transform: `translate(${dx * 0.35}px, ${dy * 0.1 - unit() * 3}px) scale(0.72) rotate(5deg)`, offset: 0.6 },
    { transform: 'none', opacity: 1 },
  ];
}
// 卡片隨風飄走 / 從風裡飄回來
function windKeyframes() {
  return [
    { transform: 'none', opacity: 1 },
    { transform: `translate(${innerWidth * 0.55}px, ${-innerHeight * 0.32}px) rotate(18deg) scale(0.7)`, opacity: 0 },
  ];
}
const fade = [{ opacity: 0 }, { opacity: 1 }];
// 倒著播：順序反過來，offset 也要跟著換成 1 - offset（不然瀏覽器會報錯）
function reversed(frames) {
  return [...frames].reverse().map((f) => (f.offset == null ? f : { ...f, offset: 1 - f.offset }));
}

function animateIn(card, from) {
  if (reduceMotion.matches) return card.animate(fade, { duration: 220 }).finished;
  if (from === 'wind') return card.animate(reversed(windKeyframes()), { duration: 760, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' }).finished;
  return card.animate(mailboxKeyframes(), { duration: 980, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)' }).finished;
}
function animateOut(card, to) {
  card.style.pointerEvents = 'none';
  if (reduceMotion.matches) return card.animate(reversed(fade), { duration: 180, fill: 'forwards' }).finished;
  if (to === 'wind') return card.animate(windKeyframes(), { duration: 620, easing: 'cubic-bezier(0.55, 0, 0.8, 0.4)', fill: 'forwards' }).finished;
  if (to === 'drop') return card.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(30px) scale(0.92)', opacity: 0 }], { duration: 360, easing: 'ease-in', fill: 'forwards' }).finished;
  return card.animate(reversed(mailboxKeyframes()), { duration: 620, easing: 'cubic-bezier(0.6, 0, 0.8, 0.5)', fill: 'forwards' }).finished;
}

// dir：enter（從信箱飄出）/ next（舊的隨風飄走、新的從信箱飄出）/ prev（舊的回到信箱、上一張從風裡飄回來）/ remove
// 「目前這張」記在 state.card：快速翻頁時，上一張可能還在飄走的動畫中，不能拿卡片槽裡的第一張來當目前這張
async function showCard(i, dir) {
  state.index = i;
  const old = state.card;
  const card = buildCard(i);
  state.card = card;
  els.cardSlot.append(card);
  fitCard(card);
  updateNav();
  const outTo = { next: 'wind', prev: 'return', remove: 'drop' }[dir];
  const jobs = [animateIn(card, dir === 'prev' ? 'wind' : 'mailbox')];
  // 動畫不管成功或被打斷，舊卡片最後一定移除
  if (old) jobs.push(animateOut(old, outTo).catch(() => {}).finally(() => old.remove()));
  if (i >= state.letters.length) celebrate(card);
  await Promise.race([Promise.all(jobs).catch(() => {}), wait(CONFIG.navLockMs)]);
}

function updateNav() {
  const n = state.letters.length;
  const atEnd = state.index >= n;
  els.prev.disabled = state.index <= 0;
  els.next.disabled = atEnd;
  els.counter.textContent = atEnd ? `共 ${n} 張` : `${state.index + 1} / ${n}`;
}

async function go(delta) {
  if (state.phase !== 'open' || state.busy) return;
  const i = state.index + delta;
  if (i < 0 || i > state.letters.length) return;
  state.busy = true;
  try {
    await showCard(i, delta > 0 ? 'next' : 'prev');
  } finally {
    state.busy = false; // 就算動畫出錯也要解鎖，翻頁才不會卡住
  }
}
els.next.addEventListener('click', () => go(1));
els.prev.addEventListener('click', () => go(-1));

// 移除：按一次變成「確定移除？」，3 秒內再按一次才真的移除
function onRemove(btn) {
  if (state.busy) return;
  if (!btn.classList.contains('is-confirm')) {
    btn.classList.add('is-confirm');
    btn.textContent = '確定移除？';
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.classList.remove('is-confirm'); btn.textContent = '移除這張'; }, 3000);
    return;
  }
  clearTimeout(btn._t);
  state.busy = true;
  state.letters.splice(state.index, 1);
  showCard(Math.min(state.index, state.letters.length), 'remove').finally(() => { state.busy = false; });
}

document.addEventListener('keydown', (e) => {
  if (state.phase !== 'open' || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  const onButton = e.target.closest && e.target.closest('button');
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !onButton)) { e.preventDefault(); go(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
});

/* ==========================================================
   風格切換
   ========================================================== */
function setTheme(theme, { initial = false } = {}) {
  if (theme !== 'meadow' && theme !== 'ice') theme = 'meadow';
  const changed = theme !== state.theme;
  state.theme = theme;
  els.root.dataset.theme = theme;
  els.themeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeValue === theme)));
  // 名字和「生日快樂」各自不拆行，窄螢幕時從中間換行
  els.greetTitle.replaceChildren(...TEXT[theme].title.split(' ').flatMap((w, i) => (i ? [' ', el('span', 'nowrap', w)] : [el('span', 'nowrap', w)])));
  const endTitle = els.cardSlot.querySelector('.end-title');
  if (endTitle) fillEndTitle(endTitle);
  try { localStorage.setItem('theme', theme); } catch (e) { /* 存不了就算了 */ }
  if (theme === 'meadow' && (changed || initial)) growVine();
  if (changed && !initial) {
    gust(theme);
    switchTrack();
  }
}
els.themeBtns.forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeValue)));

function growVine() {
  if (reduceMotion.matches) return;
  const box = els.mailbox;
  box.classList.remove('is-growing');
  void box.offsetWidth; // 重新觸發動畫
  box.classList.add('is-growing');
}

/* ==========================================================
   背景音樂：用 audio.volume 做淡入淡出，切換風格時換曲
   ========================================================== */
// iOS Safari 的 volume 是唯讀（永遠 1）：淡入淡出做不到，改成直接播放 / 暫停
const canSetVolume = (() => { const a = new Audio(); a.volume = 0.5; return a.volume === 0.5; })();

let bgmVolume = CONFIG.bgmVolume;
try {
  const saved = parseFloat(localStorage.getItem('bgmVolume'));
  if (saved >= 0 && saved <= 1) bgmVolume = saved;
} catch (e) { /* 讀不到就用預設 */ }

let bgmMissing = false; // 檔案還沒放進來：不要一直重試
els.bgm.addEventListener('error', () => { bgmMissing = true; });
function loadTrack() {
  bgmMissing = false;
  els.bgm.src = CONFIG.bgm[state.theme];
  els.bgm.volume = 0;
}

let fadeTimer = 0;
function fadeBgm(target, ms, done) {
  clearInterval(fadeTimer);
  if (!canSetVolume) { if (done) done(); return; }
  const from = els.bgm.volume;
  const start = performance.now();
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - start) / ms);
    els.bgm.volume = Math.max(0, Math.min(1, from + (target - from) * k));
    if (k >= 1) {
      clearInterval(fadeTimer);
      if (done) done();
    }
  }, 30);
}

// 一打開網頁就播。瀏覽器若擋下有聲自動播放，就等第一次點擊 / 按鍵再播
let audioUnlocked = false;
let waitingGesture = false;
function waitForGesture() {
  if (waitingGesture) return;
  waitingGesture = true;
  const goPlay = () => {
    waitingGesture = false;
    ['pointerdown', 'keydown'].forEach((t) => document.removeEventListener(t, goPlay, true));
    syncMusic();
  };
  ['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, goPlay, true));
}

function syncMusic() {
  if (state.musicOn && !bgmMissing) {
    if (els.bgm.paused) {
      els.bgm.play().then(() => {
        audioUnlocked = true;
        fadeBgm(bgmVolume, CONFIG.bgmFadeInMs);
      }).catch(() => {
        if (bgmMissing) return;
        if (!audioUnlocked) waitForGesture();
        else if (els.bgm.paused) setMusicOn(false); // 播過之後又被擋：開關切成「關」，讓使用者點一下重試
      });
    } else {
      fadeBgm(bgmVolume, CONFIG.bgmFadeInMs);
    }
  } else if (!els.bgm.paused) {
    fadeBgm(0, CONFIG.bgmFadeOutMs, () => els.bgm.pause());
  }
}

function switchTrack() {
  const swap = () => { els.bgm.pause(); loadTrack(); syncMusic(); };
  if (els.bgm.paused) swap();
  else fadeBgm(0, CONFIG.bgmFadeOutMs, swap);
}

function setMusicOn(on) {
  state.musicOn = on;
  els.musicToggle.setAttribute('aria-pressed', String(on));
  els.musicToggle.setAttribute('aria-label', `背景音樂：${on ? '開' : '關'}`);
}
els.musicToggle.addEventListener('click', () => {
  setMusicOn(!state.musicOn);
  if (state.musicOn && bgmMissing) loadTrack(); // 可能剛把檔案放進來，再試一次
  syncMusic();
});

function setBgmVolume(v) {
  bgmVolume = v;
  els.volumeSlider.value = String(Math.round(v * 100));
  els.volumeNum.textContent = String(Math.round(v * 100));
  if (state.musicOn && !els.bgm.paused) { clearInterval(fadeTimer); els.bgm.volume = v; }
}
function openVolume(open) {
  els.volumePop.hidden = !open;
  els.volumeBtn.setAttribute('aria-expanded', String(open));
}
if (canSetVolume) {
  setBgmVolume(bgmVolume);
  els.volumeBtn.addEventListener('click', () => openVolume(els.volumePop.hidden));
  els.volumeSlider.addEventListener('input', () => setBgmVolume(Number(els.volumeSlider.value) / 100));
  els.volumeSlider.addEventListener('change', () => {
    try { localStorage.setItem('bgmVolume', String(bgmVolume)); } catch (e) { /* 無痕模式等存不了就算了 */ }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!els.volumePop.hidden && !els.musicCtrl.contains(e.target)) openVolume(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.volumePop.hidden) { openVolume(false); els.volumeBtn.focus(); }
  });
} else {
  els.volumeBtn.hidden = true; // iOS 不能用程式調音量，只能用手機的音量鍵
}

/* ==========================================================
   信箱上的藤蔓葉子（用程式沿著藤蔓撒，比較自然）
   ========================================================== */
const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, parent) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function buildVine() {
  // 柱腳的草叢：和前景的草一樣是尖細的草葉
  const blades = $('groundBlades');
  for (let i = 0; i < 26; i++) {
    const x = 64 + (i / 25) * 96 + rand(-3, 3);
    const mid = 1 - Math.abs(x - 112) / 60; // 越靠近柱子越高
    const h = rand(14, 22) + mid * rand(10, 22);
    const lean = rand(-0.45, 0.45) * h;
    const w = rand(1.8, 2.8);
    const tipX = x + lean, tipY = 374 - h;
    svg('path', {
      class: i % 3 ? 'ground-blade' : 'ground-blade light',
      d: `M${(x - w).toFixed(1)} 374 Q ${(x + lean * 0.35 - w * 0.4).toFixed(1)} ${(374 - h * 0.5).toFixed(1)} ${tipX.toFixed(1)} ${tipY.toFixed(1)} Q ${(x + lean * 0.35 + w * 0.4).toFixed(1)} ${(374 - h * 0.5).toFixed(1)} ${(x + w).toFixed(1)} 374 Z`,
    }, blades);
  }

  // 信箱上的藤蔓葉子
  const vine = $('vinePath');
  const total = vine.getTotalLength();
  let n = 0;
  for (let s = 0.04; s < 0.98; s += 0.045) {
    const p = vine.getPointAtLength(s * total);
    const q = vine.getPointAtLength(Math.min(total, (s + 0.01) * total));
    const ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    const side = n % 2 ? 1 : -1;
    const d = `${Math.round(s * 2000)}ms`;
    const g = svg('g', { transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${(ang + side * 55).toFixed(1)})` }, els.vineLeaves);
    const leaf = svg('path', { class: n % 3 ? 'vine-leaf' : 'vine-leaf light', d: 'M0 0 C 4 -6, 14 -6, 18 0 C 14 6, 4 6, 0 0 Z' }, g);
    leaf.style.setProperty('--d', d);
    if (n % 5 === 2) {
      const fl = svg('g', { transform: `translate(${(-side * 6).toFixed(1)} ${(side * 6).toFixed(1)})` }, g);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const c = svg('circle', { class: 'vine-flower', cx: (Math.cos(a) * 4).toFixed(1), cy: (Math.sin(a) * 4).toFixed(1), r: 3 }, fl);
        c.style.setProperty('--d', d);
      }
      svg('circle', { class: 'vine-flower-eye', r: 2.4 }, fl).style.setProperty('--d', d);
    }
    n++;
  }
}

/* ==========================================================
   背景粒子：花瓣、嫩葉、光點（草木）、雪花與星星（冰雪）
   ========================================================== */
const ctx = els.canvas.getContext('2d');
const frontCtx = els.front.getContext('2d');
let W = 0, H = 0, DPR = 1;
let floats = [], flakes = [], stars = [], burst = [];
const mix = { meadow: 1, ice: 0 }; // 兩組粒子的透明度，切換風格時慢慢交叉淡化

// 草木的飄浮物：花瓣（粉 / 白 / 淡黃）、嫩葉（兩種新綠）、光點
function makePetalSprite(base, tip) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32);
  // 櫻花瓣形狀：下窄上寬，頂端有一個小缺口
  g.beginPath();
  g.moveTo(0, 26);
  g.bezierCurveTo(-22, 10, -20, -18, -7, -24);
  g.lineTo(0, -17);
  g.lineTo(7, -24);
  g.bezierCurveTo(20, -18, 22, 10, 0, 26);
  const grd = g.createLinearGradient(0, 26, 0, -24);
  grd.addColorStop(0, base);
  grd.addColorStop(1, tip);
  g.fillStyle = grd;
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(0, 22); g.lineTo(0, -10); g.stroke();
  return c;
}
function makeLeafSprite(light, dark) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32);
  g.beginPath();
  g.moveTo(0, 28);
  g.bezierCurveTo(-18, 10, -16, -16, 0, -28);
  g.bezierCurveTo(16, -16, 18, 10, 0, 28);
  const grd = g.createLinearGradient(-16, -10, 16, 10);
  grd.addColorStop(0, light);
  grd.addColorStop(1, dark);
  g.fillStyle = grd;
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(0, 26); g.lineTo(0, -22);
  for (let k = -1; k <= 1; k++) { g.moveTo(0, k * 9); g.lineTo(-8, k * 9 - 7); g.moveTo(0, k * 9 + 3); g.lineTo(8, k * 9 - 4); }
  g.stroke();
  return c;
}
function makeMoteSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.18, 'rgba(255,250,210,0.85)');
  grd.addColorStop(0.5, 'rgba(255,240,170,0.25)');
  grd.addColorStop(1, 'rgba(255,240,170,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return c;
}
// 離鏡頭近的花瓣 / 葉子用模糊版本（瀏覽器不支援 canvas filter 時就用原圖）
function blurred(src, px) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.filter = `blur(${px}px)`;
  g.drawImage(src, 8, 8, 48, 48);
  return c;
}
function makeFlakeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  for (let k = 0; k < 6; k++) {
    g.save();
    g.rotate((k / 6) * Math.PI * 2);
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(0, -26);
    g.moveTo(0, -14); g.lineTo(-7, -20);
    g.moveTo(0, -14); g.lineTo(7, -20);
    g.stroke();
    g.restore();
  }
  return c;
}
function makeBokehSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.55, 'rgba(235,243,255,0.55)');
  grd.addColorStop(1, 'rgba(235,243,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return c;
}
const FLOAT_SPRITES = {
  petal: [makePetalSprite('#ffb3c8', '#ffe4ec'), makePetalSprite('#f3e6e0', '#ffffff'), makePetalSprite('#ffe07a', '#fff6c8')],
  leaf: [makeLeafSprite('#c2ef86', '#76c24c'), makeLeafSprite('#a5e070', '#4f9e3a')],
};
FLOAT_SPRITES.petalBlur = FLOAT_SPRITES.petal.map((c) => blurred(c, 3));
FLOAT_SPRITES.leafBlur = FLOAT_SPRITES.leaf.map((c) => blurred(c, 3));
const moteSprite = makeMoteSprite();
const bokehSprite = makeBokehSprite();
const flakeSprite = makeFlakeSprite();

// 草木的飄浮物：花瓣 45%、嫩葉 33%、光點 22%。z 是遠近，越近越大、越快，最近的會模糊
function newFloat(anywhere) {
  const s = Math.max(0.6, unit() / 19.2);
  const roll = Math.random();
  const kind = roll < 0.45 ? 'petal' : roll < 0.78 ? 'leaf' : 'mote';
  const z = rand(0.5, 1.5);
  const near = z > 1.32;
  if (kind === 'mote') {
    return {
      kind, z,
      x: rand(0, W),
      y: anywhere ? rand(H * 0.1, H) : H + rand(10, 60),
      vx: rand(-6, 10) * s,
      vy: -rand(10, 26) * s * z,
      size: rand(16, 34) * s * z,
      phase: rand(0, Math.PI * 2),
      sway: rand(0.4, 1),
      tw: rand(1, 2.6),
      a: rand(0.5, 0.9),
    };
  }
  const list = FLOAT_SPRITES[near ? `${kind}Blur` : kind];
  return {
    kind, z,
    sprite: list[Math.floor(Math.random() * list.length)],
    x: anywhere ? rand(0, W) : rand(-W * 0.2, -40),
    y: rand(H * 0.02, H * 0.9),
    vx: rand(26, 60) * s * z,
    vy: rand(4, 18) * s * z,
    size: (kind === 'petal' ? rand(22, 34) : rand(24, 40)) * s * z * (near ? 1.4 : 1),
    rot: rand(0, Math.PI * 2),
    spin: rand(-1.4, 1.4),
    flip: rand(0, Math.PI * 2),
    flipSpeed: rand(1.4, 3.2),
    phase: rand(0, Math.PI * 2),
    sway: rand(0.5, 1.2),
    a: near ? rand(0.5, 0.75) : rand(0.7, 1),
  };
}
function newFlake(anywhere) {
  const s = unit() / 19.2;
  const kind = Math.random();
  const crystal = kind < 0.12;
  const bokeh = !crystal && kind > 0.94; // 離鏡頭很近、模糊的大雪片
  return {
    x: rand(-20, W + 20),
    y: anywhere ? rand(0, H) : rand(-60, -10),
    vy: rand(28, 75) * s * (crystal ? 0.8 : bokeh ? 1.8 : 1),
    vx: rand(-8, 8) * s,
    r: crystal ? rand(9, 16) * Math.max(0.6, s) : bokeh ? rand(9, 20) * Math.max(0.6, s) : rand(1.2, 3.6) * Math.max(0.7, s),
    crystal,
    bokeh,
    phase: rand(0, Math.PI * 2),
    spin: rand(-0.6, 0.6),
    rot: rand(0, Math.PI),
    a: rand(0.55, 1),
  };
}

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  els.canvas.width = Math.round(W * DPR);
  els.canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  Scenery.resize(W, H, DPR, { meadow: els.bgMeadow, ice: els.bgIce, front: els.front });
  els.cardSlot.querySelectorAll('.card').forEach(fitCard);
  const calm = reduceMotion.matches ? 0.4 : 1;
  const nFloats = Math.round(Math.min(110, W * H * CONFIG.floatDensity) * calm);
  const nFlakes = Math.round(Math.min(320, W * H * CONFIG.snowDensity) * calm);
  floats = Array.from({ length: nFloats }, () => newFloat(true)).sort((a, b) => a.z - b.z);
  flakes = Array.from({ length: nFlakes }, () => newFlake(true));
  stars = Array.from({ length: CONFIG.starCount }, () => ({
    x: rand(0, W), y: rand(0, H * 0.55), r: rand(0.7, 2), phase: rand(0, Math.PI * 2), tw: rand(0.8, 2.2),
  }));
}

// 切換風格時吹一陣：新風格的粒子多一些從畫面中間散開
function gust(theme) {
  if (reduceMotion.matches) return;
  const n = theme === 'meadow' ? 36 : 70;
  for (let i = 0; i < n; i++) spawnBurst(theme, rand(W * 0.2, W * 0.8), rand(H * 0.3, H * 0.8), 1);
}
// 結尾卡片：從卡片裡噴出飛絮或雪花
function celebrate(card) {
  if (reduceMotion.matches) return;
  const r = els.cardSlot.getBoundingClientRect();
  const n = state.theme === 'meadow' ? 70 : 110;
  for (let i = 0; i < n; i++) spawnBurst(state.theme, r.left + r.width / 2 + rand(-r.width / 3, r.width / 3), r.top + r.height / 2 + rand(-r.height / 4, r.height / 4), 1.6);
}
function spawnBurst(theme, x, y, power) {
  const s = unit() / 19.2;
  const a = rand(0, Math.PI * 2);
  const v = rand(60, 240) * s * power;
  const base = theme === 'meadow' ? newFloat(true) : newFlake(true);
  burst.push({ ...base, theme, x, y, bvx: Math.cos(a) * v, bvy: Math.sin(a) * v - 60 * s, life: 0, ttl: rand(2.4, 4.2) });
}

function stepFloat(p, t, dt, wind) {
  if (p.kind === 'mote') {
    p.x += (p.vx + Math.sin(t * p.sway + p.phase) * 8) * dt;
    p.y += p.vy * dt;
    return;
  }
  p.x += p.vx * wind * dt;
  p.y += (p.vy + Math.sin(t * p.sway + p.phase) * 22 * p.z) * dt;
  p.rot += p.spin * dt;
  p.flip += p.flipSpeed * dt;
}
function drawFloat(p, t, alpha) {
  if (p.kind === 'mote') {
    ctx.globalAlpha = alpha * p.a * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * p.tw + p.phase)));
    ctx.drawImage(moteSprite, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha * p.a;
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  // 用 scaleY 模擬花瓣 / 葉子在空中翻面
  ctx.scale(1, 0.25 + 0.75 * Math.abs(Math.cos(p.flip)));
  ctx.drawImage(p.sprite, -p.size / 2, -p.size / 2, p.size, p.size);
  ctx.restore();
}
function drawFlake(p, alpha) {
  ctx.globalAlpha = alpha * p.a;
  if (p.crystal) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.drawImage(flakeSprite, -p.r, -p.r, p.r * 2, p.r * 2);
    ctx.restore();
  } else if (p.bokeh) {
    ctx.globalAlpha = alpha * p.a * 0.45;
    ctx.drawImage(bokehSprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
  } else {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  const k = Math.min(1, dt * 1.1);
  mix.meadow += ((state.theme === 'meadow' ? 1 : 0) - mix.meadow) * k;
  mix.ice += ((state.theme === 'ice' ? 1 : 0) - mix.ice) * k;
  const speed = reduceMotion.matches ? 0.35 : 1;
  const wind = (Math.sin(t * 0.23) * 0.5 + Math.sin(t * 0.61) * 0.3 + 0.9) * speed;

  ctx.clearRect(0, 0, W, H);
  Scenery.drawSky(ctx, t, dt * speed, mix);

  if (mix.ice > 0.01) {
    ctx.fillStyle = '#ffffff';
    for (const s of stars) {
      ctx.globalAlpha = mix.ice * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.tw + s.phase)));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (mix.meadow > 0.01) {
    for (const p of floats) {
      stepFloat(p, t, dt * speed, wind);
      if (p.x > W + 80 || p.y < -80 || p.y > H + 80) Object.assign(p, newFloat(false));
      drawFloat(p, t, mix.meadow);
    }
  }

  if (mix.ice > 0.01) {
    ctx.fillStyle = '#ffffff';
    for (const p of flakes) {
      p.y += p.vy * speed * dt;
      p.x += (p.vx + Math.sin(t * 0.8 + p.phase) * 16 + (wind - 0.9) * 20) * speed * dt;
      p.rot += p.spin * dt;
      if (p.y > H + 20) Object.assign(p, newFlake(false));
      drawFlake(p, mix.ice);
    }
  }

  // 噴發的粒子：先往外衝，慢慢減速後跟著風飄
  ctx.fillStyle = '#ffffff';
  for (let i = burst.length - 1; i >= 0; i--) {
    const p = burst[i];
    p.life += dt;
    const drag = Math.exp(-dt * 1.6);
    p.bvx *= drag; p.bvy *= drag;
    if (p.theme === 'meadow') {
      stepFloat(p, t, dt, wind);
      p.x += p.bvx * dt;
      p.y += p.bvy * dt;
    } else {
      p.x += p.bvx * dt;
      p.y += (p.bvy + p.vy * 0.6) * dt;
      p.rot += p.spin * dt;
    }
    const fadeK = Math.min(1, p.life / 0.2) * Math.min(1, (p.ttl - p.life) / 0.8);
    if (p.life >= p.ttl) { burst.splice(i, 1); continue; }
    if (p.theme === 'meadow') drawFloat(p, t, fadeK);
    else drawFlake(p, fadeK);
  }
  ctx.globalAlpha = 1;
  Scenery.drawFront(frontCtx, t, mix, wind, reduceMotion.matches);
  requestAnimationFrame(frame);
}

/* ==========================================================
   Init
   ========================================================== */
let savedTheme = 'meadow';
try { savedTheme = localStorage.getItem('theme') || 'meadow'; } catch (e) { /* 預設草木 */ }
state.theme = savedTheme === 'ice' ? 'ice' : 'meadow';
mix.meadow = state.theme === 'meadow' ? 1 : 0;
mix.ice = 1 - mix.meadow;
buildVine();
setTheme(state.theme, { initial: true });
resize();
let resizeTimer = 0;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 150); });
requestAnimationFrame(frame);
loadTrack();
syncMusic();
