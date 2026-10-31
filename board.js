/* ==========================================================
   大家的祝福：結尾卡片按「看大家的祝福」打開
   每個人的名字和想說的話是一張用紙膠帶貼著的小信紙，貼成一面祝福牆；點小信紙可以放大看
   膠帶顏色跟著風格（草木綠 / 冰雪藍）
   「保存成圖片」：自己用 canvas 把背景、標題和每張小信紙重畫一次，存成 PNG 當合影
   ========================================================== */
const Board = (() => {
  const layer = $('board');
  const wall = $('boardWall');
  const countEl = $('boardCount');
  const zoom = $('noteZoom');
  let list = [];       // 打開時的問卷（照播放的順序）
  let zoomIndex = -1;
  let hidden = [];     // 打開時淡出的信箱、問候、問卷卡片（前景的草 / 積雪留著）
  const looks = new WeakMap(); // 每封問卷固定一組傾斜、大小、漂浮節奏（重新排版時不會亂跳）

  function lookOf(L) {
    if (!looks.has(L)) {
      const len = [...(L.words || '')].length;
      looks.set(L, {
        tilt: Math.random() * 7 - 3.5,
        // 短的字大、長的小一點，大小錯落才像貼滿祝福的牆
        size: (len <= 8 ? 1.3 : len <= 24 ? 1.1 : len <= 60 ? 0.96 : 0.88) * (0.9 + Math.random() * 0.2),
        lift: Math.random() * 1.2 - 0.6,
        delay: -Math.random() * 6,
        dur: 5 + Math.random() * 3,
      });
    }
    return looks.get(L);
  }

  function note(L, i) {
    const look = lookOf(L);
    const b = el('button', 'note');
    b.type = 'button';
    b.dataset.i = i;
    b.style.setProperty('--tilt', `${look.tilt.toFixed(2)}deg`);
    b.style.setProperty('--size', look.size.toFixed(2));
    b.style.setProperty('--lift', `${look.lift.toFixed(2)}em`);
    b.style.setProperty('--delay', `${look.delay.toFixed(2)}s`);
    b.style.setProperty('--dur', `${look.dur.toFixed(2)}s`);
    b.setAttribute('aria-label', `${L.name || ANON}：${L.words || ''}`);
    b.addEventListener('click', () => openZoom(i));
    const name = el('span', 'note-name', L.name || ANON);
    if (!L.name) name.classList.add('is-anon');
    b.append(el('span', 'note-tape'), name);
    if (L.words) b.append(el('span', 'note-text', L.words));
    return b;
  }

  // 祝福多的時候整體縮小字級，盡量一個畫面放得下（太多就捲動）
  function fit() {
    let size = Math.max(14, Math.min(24, innerWidth / 64));
    wall.style.setProperty('--fs', `${size}px`);
    while (wall.scrollHeight > wall.clientHeight + 1 && size > 10) {
      size -= 1;
      wall.style.setProperty('--fs', `${size}px`);
    }
  }

  /* ============ 打開 / 關閉 ============ */
  function open() {
    list = [...state.letters];
    wall.replaceChildren(...list.map(note));
    countEl.textContent = `共 ${list.length} 位苒寶`;
    layer.hidden = false;
    els.stage.inert = true;
    hidden = [...els.stage.children].filter((e) => e !== els.front)
      .map((e) => e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduceMotion.matches ? 1 : 500, fill: 'forwards' }));
    fit();
    if (!reduceMotion.matches) {
      layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
      [...wall.children].forEach((e, k) => e.animate(
        [{ opacity: 0, translate: '0 1.2em', scale: '0.9' }, { opacity: 1, translate: '0 0', scale: '1' }],
        { duration: 600, delay: 200 + Math.min(k * 40, 1400), easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)', fill: 'backwards' },
      ));
    }
    $('boardSave').focus({ preventScroll: true });
  }
  function close() {
    closeZoom();
    layer.hidden = true;
    els.stage.inert = false;
    hidden.forEach((a) => a.cancel());
    hidden = [];
    els.cardSlot.querySelector('.end-back')?.focus({ preventScroll: true });
  }
  $('boardBack').addEventListener('click', close);
  window.addEventListener('resize', () => { if (!layer.hidden) fit(); });

  /* ============ 點開單張祝福 ============ */
  function showZoom(i) {
    const L = list[i];
    zoomIndex = i;
    const name = $('zoomName');
    name.textContent = L.name || ANON;
    name.classList.toggle('is-anon', !L.name);
    $('zoomText').textContent = L.words || '';
    $('zoomPos').textContent = `${i + 1} / ${list.length}`;
    $('zoomPrev').disabled = i <= 0;
    $('zoomNext').disabled = i >= list.length - 1;
  }
  function openZoom(i) {
    showZoom(i);
    zoom.hidden = false;
    if (!reduceMotion.matches) {
      $('zoomCard').animate([{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    }
    $('zoomClose').focus({ preventScroll: true });
  }
  function closeZoom() {
    if (zoom.hidden) return;
    zoom.hidden = true;
    wall.querySelector(`[data-i="${zoomIndex}"]`)?.focus({ preventScroll: true });
    zoomIndex = -1;
  }
  function stepZoom(d) {
    const i = zoomIndex + d;
    if (i >= 0 && i < list.length) showZoom(i);
  }
  $('zoomClose').addEventListener('click', closeZoom);
  $('zoomPrev').addEventListener('click', () => stepZoom(-1));
  $('zoomNext').addEventListener('click', () => stepZoom(1));
  zoom.addEventListener('click', (e) => { if (e.target === zoom) closeZoom(); }); // 點外面關閉
  document.addEventListener('keydown', (e) => {
    if (layer.hidden) return;
    if (zoom.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); closeZoom(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); stepZoom(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); stepZoom(1); }
  });

  /* ============ 存成圖片 ============ */
  // 照 DOM 上每個字的位置一個字一個字畫，換行和網頁上完全一樣
  function drawText(g, node) {
    const cs = getComputedStyle(node);
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    g.fillStyle = cs.color;
    g.textBaseline = 'alphabetic';
    const ascent = g.measureText('字').fontBoundingBoxAscent;
    const range = document.createRange();
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const s = t.data;
      for (let i = 0; i < s.length;) {
        const len = s.codePointAt(i) > 0xffff ? 2 : 1;
        const ch = s.slice(i, i + len);
        if (ch.trim()) {
          range.setStart(t, i);
          range.setEnd(t, i + len);
          const r = range.getClientRects()[0];
          if (r) g.fillText(ch, r.left, r.top + (ascent || r.height * 0.8));
        }
        i += len;
      }
    }
  }

  function drawNote(g, node) {
    const look = lookOf(list[Number(node.dataset.i)]);
    const cs = getComputedStyle(node);
    const em = parseFloat(cs.fontSize);
    const r = node.getBoundingClientRect();
    g.save();
    g.translate(r.left + r.width / 2, r.top + r.height / 2);
    g.rotate((look.tilt * Math.PI) / 180);
    g.translate(-(r.left + r.width / 2), -(r.top + r.height / 2));

    // 信紙 + 影子 + 一圈細邊
    g.shadowColor = getComputedStyle(document.documentElement).getPropertyValue('--shadow').trim() || 'rgba(0,0,0,0.3)';
    g.shadowBlur = em * 1;
    g.shadowOffsetY = em * 0.4;
    g.beginPath();
    g.roundRect(r.left, r.top, r.width, r.height, em * 0.3);
    g.fillStyle = cs.backgroundColor;
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = 1;
    g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--card-edge').trim();
    g.stroke();
    // 紙膠帶
    const tape = node.querySelector('.note-tape');
    const tr = tape.getBoundingClientRect();
    g.fillStyle = getComputedStyle(tape).backgroundColor;
    g.fillRect(tr.left, tr.top, tr.width, tr.height);

    drawText(g, node.querySelector('.note-name'));
    const text = node.querySelector('.note-text');
    if (text) drawText(g, text);
    g.restore();
  }

  async function save(btn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '保存中…';
    layer.classList.add('is-capturing'); // 拍照時停掉漂浮動畫、拿掉傾斜，量到的位置才準
    const scroll = wall.scrollTop;
    try {
      await document.fonts.ready;
      const W = innerWidth, H = innerHeight;
      // 祝福太多、牆在捲動時，圖片往下加長，把全部祝福都放進去
      const extra = Math.max(0, wall.scrollHeight - wall.clientHeight);
      wall.scrollTop = 0;
      const TH = H + extra;
      const scale = 2;
      const c = document.createElement('canvas');
      c.width = Math.round(W * scale);
      c.height = Math.round(TH * scale);
      const g = c.getContext('2d');
      g.scale(scale, scale);

      // 背景：目前風格的景物、粒子、前景的草 / 積雪（等比放大蓋滿）
      const k = TH / H;
      const cover = (src, alpha = 1) => {
        g.globalAlpha = alpha;
        g.drawImage(src, (W - W * k) / 2, 0, W * k, TH);
        g.globalAlpha = 1;
      };
      cover(els.bgMeadow, Number(getComputedStyle(els.bgMeadow).opacity));
      cover(els.bgIce, Number(getComputedStyle(els.bgIce).opacity));
      cover(els.canvas);
      // 冰雪姬風格右下角的苒苒
      const mascot = document.querySelector('.ice-mascot');
      const mascotAlpha = Number(getComputedStyle(mascot).opacity);
      if (mascotAlpha > 0.01) {
        const img = mascot.querySelector('img');
        const mr = img.getBoundingClientRect();
        g.globalAlpha = mascotAlpha;
        g.drawImage(img, mr.left, mr.top + extra, mr.width, mr.height);
        g.globalAlpha = 1;
      }
      cover(els.front);
      g.fillStyle = getComputedStyle(layer).backgroundColor;
      g.fillRect(0, 0, W, TH);

      // 標題：和網頁一樣的光暈
      const title = $('boardTitle');
      g.save();
      g.shadowColor = getComputedStyle(document.documentElement).getPropertyValue('--title-glow').trim();
      g.shadowBlur = 24;
      drawText(g, title);
      g.restore();
      drawText(g, countEl);

      for (const node of wall.children) drawNote(g, node);

      // 右下角小小的署名
      g.font = `${Math.max(12, W / 110)}px ${getComputedStyle(document.body).fontFamily}`;
      g.fillStyle = getComputedStyle(countEl).color;
      g.globalAlpha = 0.8;
      g.textAlign = 'right';
      g.fillText(`${TEXT[state.theme].title} · ${new Date().toISOString().slice(0, 10)}`, W - 16, TH - 14);

      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `苒苒生日祝福-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      btn.textContent = '已保存 ✓';
    } catch (err) {
      console.error(err);
      btn.textContent = '保存失敗，再試一次';
    } finally {
      wall.scrollTop = scroll;
      layer.classList.remove('is-capturing');
      btn.disabled = false;
      setTimeout(() => { btn.textContent = label; }, 2500);
    }
  }
  $('boardSave').addEventListener('click', (e) => save(e.currentTarget));

  return { open, isOpen: () => !layer.hidden };
})();
