/* ==========================================================
   背景：日系動畫背景風（草木白天 / 冰雪姬夜晚）
   - 靜態層（天空、山、草地 / 雪地）畫在兩張 canvas 上，切換風格時用 CSS 交叉淡化
   - 動態層（雲、極光、流星、雪地閃光、前景的草與積雪）由 main.js 每一幀呼叫
   ========================================================== */
const Scenery = (() => {
  // 固定種子的亂數：每次打開、調整視窗大小，風景都長一樣
  function mulberry(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function valueNoise(seed) {
    const r = mulberry(seed);
    const v = Array.from({ length: 512 }, r);
    return (x) => {
      const i = Math.floor(x);
      const f = x - i;
      const u = f * f * (3 - 2 * f);
      const a = v[((i % 512) + 512) % 512];
      const b = v[(((i + 1) % 512) + 512) % 512];
      return a + (b - a) * u;
    };
  }
  function fbm(n, x, oct = 4) {
    let s = 0, a = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += a * n(x * f + i * 31.7); norm += a; a *= 0.5; f *= 2.03; }
    return s / norm;
  }
  const gauss = (r) => (r() + r() + r() + r() - 2) / 2;

  let W = 0, H = 0, S = 1, DPR = 1;
  const nFar = valueNoise(11), nMid = valueNoise(23), nNear = valueNoise(37), nMtn = valueNoise(51), nGrass = valueNoise(67);

  // 三層山丘頂端的高度（x px → y px）
  const ridge = {
    far: (x) => H * (0.705 + 0.05 * (fbm(nFar, (x / W) * 2.2) - 0.5) * 2 - 0.015 * Math.sin((x / W) * Math.PI)),
    mid: (x) => H * (0.79 + 0.045 * (fbm(nMid, (x / W) * 1.8 + 5) - 0.5) * 2),
    near: (x) => H * (0.885 + 0.035 * (fbm(nNear, (x / W) * 1.5 + 9) - 0.5) * 2),
  };
  function fillPath(fn) {
    const p = new Path2D();
    p.moveTo(0, H);
    for (let x = 0; x <= W + 8; x += 8) p.lineTo(x, fn(x));
    p.lineTo(W, H);
    p.closePath();
    return p;
  }
  function edgePath(fn) {
    const p = new Path2D();
    p.moveTo(-10, fn(0));
    for (let x = 0; x <= W + 8; x += 8) p.lineTo(x, fn(x));
    return p;
  }
  function radial(c, x, y, r, stops, sx = 1, sy = 1) {
    c.save();
    c.translate(x, y);
    c.scale(sx, sy);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    stops.forEach(([o, col]) => g.addColorStop(o, col));
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  /* ---------- 積雲：陰影色打底，再把左上的受光面疊上去（賽璐璐上色） ---------- */
  const CLOUD_DAY = { shade: '#cbd8ec', light: '#ffffff', mid: '#eef2fa', base: 'rgba(170,190,222,0.4)' };
  const CLOUD_NIGHT = { shade: '#16264a', light: '#5d77a8', mid: '#2c4373', base: 'rgba(8,16,40,0.6)' };
  // fade：底部淡出的程度。地平線上的雲 = 1（完全融進薄霧），天上飄的雲 = 0.8（底部像薄紗一樣半透明）
  function cloudSprite(w, r, pal, fade = 0.8) {
    const cw = Math.ceil(w * 1.3), ch = Math.ceil(w * 1.1);
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d');
    const baseY = ch * 0.74;
    const puffs = [];
    // 底部：彼此重疊的雲團，下緣高度只差一點點，形成平緩起伏的底線（兩端略高，雲才不會像拖著小球）
    const n = 4 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const edge = Math.abs(k - 0.5) * 2;
      const rad = w * (0.13 + r() * 0.04) * (1 - edge * 0.3);
      const bottom = baseY - w * 0.02 * edge - r() * w * 0.015;
      puffs.push([cw * 0.24 + k * cw * 0.52, bottom - rad, rad]);
    }
    const tower = 3 + Math.floor(r() * 4);
    for (let i = 0; i < tower; i++) {
      const rad = w * (0.12 + r() * 0.12);
      puffs.push([cw * (0.3 + r() * 0.4), baseY - rad * (0.9 + r() * 0.9), rad]);
    }
    const blob = (list, dx, dy, k) => {
      g.beginPath();
      list.forEach(([x, y, rr]) => { g.moveTo(x + dx + rr * k, y + dy); g.arc(x + dx, y + dy, rr * k, 0, Math.PI * 2); });
      g.fill();
    };
    g.fillStyle = pal.shade; blob(puffs, 0, 0, 1);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = pal.mid; blob(puffs, -w * 0.012, -w * 0.03, 0.99);
    g.fillStyle = pal.light; blob(puffs, -w * 0.03, -w * 0.06, 0.93);
    // 下半部的陰影：越往下越偏藍灰
    const grd = g.createLinearGradient(0, baseY - w * 0.28, 0, baseY + w * 0.16);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, pal.base);
    g.fillStyle = grd;
    g.fillRect(0, 0, cw, ch);
    if (fade > 0) {
      g.globalCompositeOperation = 'destination-out';
      const fg = g.createLinearGradient(0, baseY - w * 0.16, 0, baseY + w * 0.12);
      fg.addColorStop(0, 'rgba(0,0,0,0)');
      fg.addColorStop(1, `rgba(0,0,0,${fade})`);
      g.fillStyle = fg;
      g.fillRect(0, 0, cw, ch);
    }
    g.globalCompositeOperation = 'source-over';
    return { cv, w: cw, h: ch, baseY };
  }
  function drawCloud(c, x, baseY, w, r, pal, fade) {
    const s = cloudSprite(w, r, pal, fade);
    c.drawImage(s.cv, x - s.w / 2, baseY - s.baseY);
  }

  /* ---------- 山丘：漸層 + 筆觸紋理 + 雲影 + 頂端亮邊 ---------- */
  function hill(c, fn, colors, rim, r, opt = {}) {
    const p = fillPath(fn);
    let minY = H;
    for (let x = 0; x <= W; x += 16) minY = Math.min(minY, fn(x));
    const g = c.createLinearGradient(0, minY, 0, H);
    colors.forEach((col, i) => g.addColorStop(i / (colors.length - 1), col));
    c.save();
    c.fillStyle = g;
    c.fill(p);
    c.clip(p);
    if (opt.shadows) {
      for (let i = 0; i < opt.shadows.n; i++) {
        const x = r() * W;
        const y = fn(x) + (H - fn(x)) * (0.2 + r() * 0.6);
        const rad = H * (0.1 + r() * 0.12);
        radial(c, x, y, rad, [[0, opt.shadows.color], [1, 'rgba(0,0,0,0)']], 2.4, 0.5);
      }
    }
    if (opt.strokes) {
      const { n, colors: cols, horizontal, alpha = 1 } = opt.strokes;
      c.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const x = r() * W;
        const top = fn(x);
        const depth = Math.pow(r(), 1.3);
        const y = top + depth * (H - top);
        const len = (3 + r() * 9) * S * (0.6 + depth * 1.4);
        c.strokeStyle = cols[(r() * cols.length) | 0];
        c.globalAlpha = (0.18 + r() * 0.3) * alpha;
        c.lineWidth = Math.max(1, 1.5 * S * (0.6 + depth));
        c.beginPath();
        c.moveTo(x, y);
        if (horizontal) c.lineTo(x + len * 2.4, y + (r() - 0.5) * len * 0.2);
        else c.lineTo(x + (r() - 0.5) * len * 0.6, y - len);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
    const edge = edgePath(fn);
    [[22, 0.08], [10, 0.14], [4, 0.32]].forEach(([w, a]) => {
      c.strokeStyle = rim;
      c.globalAlpha = a;
      c.lineWidth = w * S;
      c.stroke(edge);
    });
    c.restore();
    c.globalAlpha = 1;
  }

  // 遠山（白天）：柔和的山脊，越遠越接近天空色
  function softRange(c, baseY, amp, freq, seedOff, top, bottom) {
    const fn = (x) => baseY - amp * Math.pow(fbm(nMtn, (x / W) * freq + seedOff, 5), 1.6) * 2.2;
    const p = fillPath(fn);
    const g = c.createLinearGradient(0, baseY - amp * 1.4, 0, baseY + H * 0.08);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    c.fillStyle = g;
    c.fill(p);
    c.save();
    c.clip(p);
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 3 * S;
    c.stroke(edgePath(fn));
    c.restore();
  }

  // 花園：一大片一大片的春天花田。每片以一種主色為主（偶爾混幾朵白花），
  // 底下先鋪一層淡淡的花色，花往中心聚集；近一點、大一點的畫成五瓣小花
  const FLOWER_SCHEMES = [
    ['255,222,90', ['#ffe36b', '#fff3a8', '#ffd23f'], '#f2a83b'],  // 黃
    ['255,120,130', ['#ff6f7d', '#ff9aa5', '#ffc2c8'], '#ffe36b'], // 紅
    ['255,190,214', ['#ff9fc0', '#ffc6da', '#fff0f4'], '#ffe36b'], // 粉
    ['255,170,90', ['#ffa94d', '#ffc27a', '#ffe0b0'], '#e8772e'],  // 橘
    ['190,160,255', ['#a98bff', '#c9b2ff', '#ece3ff'], '#ffe36b'], // 紫
    ['255,255,245', ['#ffffff', '#fffbea', '#f4f0dc'], '#ffd23f'], // 白
  ];
  let flowerBeds = []; // 每團花的範圍（橢圓），高草叢會避開，不會插在花圃上
  function onFlowerBed(layer, x, y) {
    return flowerBeds.some((b) => b.layer === layer && ((x - b.cx) / b.rx) ** 2 + ((y - b.cy) / b.ry) ** 2 < 1);
  }
  // 散落的花田：位置隨機、大小不一（多數是小叢，偶爾一大片），高低錯落；
  // 一片花田由 1–4 團大小不一的花群組成，形狀才不規則
  function flowerSea(c, layer, r, patches, depthPx, size) {
    const fn = ridge[layer];
    for (let p = 0; p < patches; p++) {
      const [tint, cols, eye] = FLOWER_SCHEMES[Math.floor(r() * FLOWER_SCHEMES.length)];
      const big = Math.pow(r(), 1.6);
      const pw0 = (40 + big * 300) * S * (depthPx / (60 * S));
      const cx0 = r() * W;
      const cy0 = fn(cx0) + depthPx * (0.15 + r() * 0.75);
      const clumps = 1 + Math.floor(r() * (1 + big * 3));
      for (let q = 0; q < clumps; q++) {
        const pw = pw0 * (q ? 0.35 + r() * 0.45 : 1);
        const cx = cx0 + (q ? (r() - 0.5) * pw0 * 1.4 : 0);
        const ph = Math.min(depthPx * 0.45, pw * (0.12 + r() * 0.1));
        const cy = Math.max(fn(cx) + ph * 0.6, cy0 + (q ? (r() - 0.5) * depthPx * 0.4 : 0));
        flowerBeds.push({ layer, cx, cy, rx: pw * 0.8, ry: ph * 1.2 + 12 * S });
        radial(c, cx, cy, pw, [[0, `rgba(${tint},0.45)`], [0.55, `rgba(${tint},0.2)`], [1, `rgba(${tint},0)`]], 1, ph / pw);
        const n = Math.round((pw * ph) / (size * size * S * S * 3.2));
        for (let i = 0; i < n; i++) {
          const x = cx + gauss(r) * pw * 0.6;
          const y = cy + gauss(r) * ph * 0.6;
          const top = fn(x);
          if (y < top + 2 * S) continue;
          const k = Math.min(1, (y - top) / depthPx);
          const rad = size * S * (0.6 + k * 0.7) * (0.7 + r() * 0.5);
          c.globalAlpha = 0.85 + r() * 0.15;
          c.fillStyle = r() < 0.08 ? '#ffffff' : cols[(r() * cols.length) | 0];
          c.beginPath();
          if (rad > 2.6) {
            const a0 = r() * Math.PI;
            for (let f = 0; f < 5; f++) {
              const a = a0 + (f / 5) * Math.PI * 2;
              const px = x + Math.cos(a) * rad * 0.7, py = y + Math.sin(a) * rad * 0.55;
              c.moveTo(px + rad * 0.6, py);
              c.arc(px, py, rad * 0.6, 0, Math.PI * 2);
            }
            c.fill();
            c.fillStyle = eye;
            c.beginPath();
            c.arc(x, y, rad * 0.4, 0, Math.PI * 2);
          } else {
            c.arc(x, y, rad, 0, Math.PI * 2);
          }
          c.fill();
        }
      }
    }
    c.globalAlpha = 1;
  }

  /* ---------- 草木：白天 ---------- */
  function paintMeadow(c) {
    const r = mulberry(7);
    flowerBeds = [];
    let g = c.createLinearGradient(0, 0, 0, H * 0.74);
    g.addColorStop(0, '#1b64c2');
    g.addColorStop(0.32, '#3f92e0');
    g.addColorStop(0.68, '#9fd0f2');
    g.addColorStop(1, '#e4f3f3');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // 太陽與光暈
    const sx = W * 0.14, sy = H * 0.16;
    radial(c, sx, sy, H * 1.0, [[0, 'rgba(255,250,225,0.7)'], [0.1, 'rgba(255,246,210,0.42)'], [0.35, 'rgba(255,240,200,0.12)'], [1, 'rgba(255,240,200,0)']]);
    // 鏡頭光斑：沿著太陽往畫面中心的方向
    [[0.32, 0.03, 0.10], [0.5, 0.012, 0.16], [0.62, 0.05, 0.06], [0.85, 0.02, 0.1]].forEach(([k, rr, a]) => {
      const x = sx + (W * 0.55 - sx) * k, y = sy + (H * 0.55 - sy) * k;
      radial(c, x, y, H * rr, [[0, `rgba(255,255,240,${a})`], [0.7, `rgba(220,240,255,${a * 0.6})`], [1, 'rgba(220,240,255,0)']]);
    });
    radial(c, sx, sy, H * 0.075, [[0, '#ffffff'], [0.55, '#fffdf0'], [0.75, 'rgba(255,248,215,0.8)'], [1, 'rgba(255,240,190,0)']]);

    // 地平線上的積雲
    for (let i = 0; i < 9; i++) {
      drawCloud(c, W * (i / 8) + (r() - 0.5) * W * 0.08, H * 0.675, H * (0.22 + r() * 0.26), r, CLOUD_DAY, 1);
    }
    // 雲的下半部隱在空氣裡：先蓋一層淡淡的天空色
    g = c.createLinearGradient(0, H * 0.5, 0, H * 0.7);
    g.addColorStop(0, 'rgba(214,234,246,0)');
    g.addColorStop(1, 'rgba(214,234,246,0.7)');
    c.fillStyle = g;
    c.fillRect(0, H * 0.5, W, H * 0.2);
    // 遠山：空氣透視，越遠越藍越淡
    softRange(c, H * 0.665, H * 0.045, 2.6, 3, '#a7c8e4', '#cfe3ef');
    softRange(c, H * 0.69, H * 0.04, 3.4, 11, '#86b0d0', '#bcd7e6');
    // 地平線的薄霧
    g = c.createLinearGradient(0, H * 0.6, 0, H * 0.76);
    g.addColorStop(0, 'rgba(236,247,250,0)');
    g.addColorStop(0.65, 'rgba(236,247,250,0.6)');
    g.addColorStop(1, 'rgba(236,247,250,0)');
    c.fillStyle = g;
    c.fillRect(0, H * 0.6, W, H * 0.16);

    hill(c, ridge.far, ['#b1dc86', '#8cc46a', '#6aa955'], 'rgba(250,255,215,1)', r, {
      strokes: { n: 900, colors: ['#5f9c4c', '#9fd37a', '#7bb860'] },
    });
    flowerSea(c, 'far', r, 17, 46 * S, 1.3);
    hill(c, ridge.mid, ['#9fd468', '#73b54c', '#468a39'], 'rgba(245,255,200,1)', r, {
      shadows: { n: 4, color: 'rgba(30,80,40,0.22)' },
      strokes: { n: 1800, colors: ['#3f8436', '#8fcb5e', '#5ea445', '#b5dd7a'] },
    });
    flowerSea(c, 'mid', r, 13, 80 * S, 2.3);
    hill(c, ridge.near, ['#8acb4c', '#5aa23a', '#2f7230'], 'rgba(245,255,190,1)', r, {
      shadows: { n: 5, color: 'rgba(20,70,30,0.26)' },
      strokes: { n: 2600, colors: ['#2f7a2e', '#4f9a3c', '#86c552', '#a9d86a'] },
    });
    flowerSea(c, 'near', r, 9, 110 * S, 3.4);

    // 草地上的小花
    for (let i = 0; i < 220; i++) {
      const x = r() * W;
      const near = r() < 0.7;
      const top = near ? ridge.near(x) : ridge.mid(x);
      const bottom = near ? H : ridge.near(x);
      const y = top + (bottom - top) * (0.1 + r() * 0.85);
      const size = (1.6 + r() * 2.4) * S * (near ? 1.3 : 0.8);
      const col = r() < 0.5 ? '#fffbea' : r() < 0.7 ? '#ffe36b' : '#ffd1dc';
      c.fillStyle = col;
      c.globalAlpha = 0.9;
      for (let k = 0; k < 4; k++) {
        c.beginPath();
        c.arc(x + (r() - 0.5) * size * 4, y + (r() - 0.5) * size * 1.5, size, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  /* ---------- 冰雪姬：夜晚 ---------- */
  function snowPeak(c, px, py, bw, baseY, r, pal) {
    const steps = 8;
    const L = [], R = [], spine = [];
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const jy = (r() - 0.5) * (baseY - py) * 0.05;
      L.push([px - (bw / 2) * k + (r() - 0.5) * bw * 0.05, py + (baseY - py) * k + jy]);
      R.push([px + (bw / 2) * k + (r() - 0.5) * bw * 0.05, py + (baseY - py) * k - jy]);
      spine.push([px - bw * 0.1 * k + (r() - 0.5) * bw * 0.07, py + (baseY - py) * k]);
    }
    const shape = new Path2D();
    shape.moveTo(L[steps - 1][0], baseY + 2);
    [...L].reverse().forEach(([x, y]) => shape.lineTo(x, y));
    shape.lineTo(px, py);
    R.forEach(([x, y]) => shape.lineTo(x, y));
    shape.lineTo(R[steps - 1][0], baseY + 2);
    shape.closePath();
    const lit = new Path2D();
    lit.moveTo(px, py);
    L.forEach(([x, y]) => lit.lineTo(x, y));
    lit.lineTo(L[steps - 1][0], baseY + 2);
    lit.lineTo(spine[steps - 1][0], baseY + 2);
    [...spine].reverse().forEach(([x, y]) => lit.lineTo(x, y));
    lit.closePath();
    const capY = py + (baseY - py) * (0.3 + r() * 0.15);
    const cap = new Path2D();
    cap.moveTo(px - bw, py - 20);
    cap.lineTo(px + bw, py - 20);
    for (let x = px + bw; x >= px - bw; x -= bw / 14) {
      const drip = r() < 0.3 ? (baseY - py) * (0.08 + r() * 0.12) : 0;
      cap.lineTo(x, capY + (r() - 0.5) * (baseY - py) * 0.12 + drip);
    }
    cap.closePath();

    c.save();
    c.clip(shape);
    c.fillStyle = pal.rockShade; c.fillRect(px - bw, py - 10, bw * 2, baseY - py + 20);
    c.fillStyle = pal.snowShade; c.fill(cap);
    c.save();
    c.clip(lit);
    c.fillStyle = pal.rockLit; c.fillRect(px - bw, py - 10, bw * 2, baseY - py + 20);
    c.fillStyle = pal.snowLit; c.fill(cap);
    c.restore();
    c.restore();
  }

  function pine(c, x, y, h, lit) {
    const w = h * 0.44;
    c.fillStyle = '#0d1b37';
    c.fillRect(x - h * 0.03, y - h * 0.1, h * 0.06, h * 0.12);
    for (let t = 0; t < 4; t++) {
      const ty = y - h * 0.08 - h * t * 0.21;
      const tw = w * (1 - t * 0.21);
      const th = h * 0.38;
      c.fillStyle = '#0d1b37';
      c.beginPath();
      c.moveTo(x - tw / 2, ty);
      c.lineTo(x + tw / 2, ty);
      c.lineTo(x, ty - th);
      c.closePath();
      c.fill();
      // 月光從左上照：左邊的積雪比較亮
      c.fillStyle = lit;
      c.beginPath();
      c.moveTo(x, ty - th);
      c.quadraticCurveTo(x - tw * 0.22, ty - th * 0.45, x - tw / 2, ty);
      c.lineTo(x - tw * 0.32, ty - th * 0.05);
      c.quadraticCurveTo(x - tw * 0.12, ty - th * 0.4, x, ty - th * 0.78);
      c.closePath();
      c.fill();
      c.globalAlpha = 0.75;
      c.beginPath();
      c.ellipse(x - tw * 0.12, ty - h * 0.01, tw * 0.34, h * 0.03, 0, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
  }

  /* ---------- 冰雪姬的冰宮：半透明的冰晶城堡，月光從左上照，左側受光 ---------- */
  let palaceTips = []; // 塔尖的位置，動態層會讓它們閃光
  function palaceX() { return W * 0.78; }
  function palace(c) {
    const px = palaceX();
    const base = ridge.far(px) + 10 * S;
    const k = S;
    palaceTips = [];
    // 背後的冰藍光暈
    radial(c, px, base - 120 * k, 260 * k, [[0, 'rgba(140,200,255,0.32)'], [0.5, 'rgba(120,180,255,0.12)'], [1, 'rgba(120,180,255,0)']], 1, 0.8);
    c.save();
    c.shadowColor = 'rgba(160,210,255,0.9)';
    c.shadowBlur = 14 * k;
    // 城牆：中間一段，頂端是冰晶鋸齒
    const wallH = 50 * k, wallL = px - 104 * k, wallR = px + 104 * k;
    let g = c.createLinearGradient(wallL, 0, wallR, 0);
    g.addColorStop(0, 'rgba(205,232,255,0.82)');
    g.addColorStop(0.45, 'rgba(150,195,245,0.7)');
    g.addColorStop(1, 'rgba(95,140,210,0.7)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(wallL, base);
    c.lineTo(wallL, base - wallH);
    for (let x = wallL; x < wallR; x += 12 * k) {
      c.lineTo(x + 6 * k, base - wallH - 9 * k);
      c.lineTo(x + 12 * k, base - wallH);
    }
    c.lineTo(wallR, base);
    c.closePath();
    c.fill();
    // 城門：拱形，透出淡淡的光
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(235,248,255,0.9)';
    c.beginPath();
    c.moveTo(px - 13 * k, base);
    c.lineTo(px - 13 * k, base - 26 * k);
    c.quadraticCurveTo(px, base - 44 * k, px + 13 * k, base - 26 * k);
    c.lineTo(px + 13 * k, base);
    c.closePath();
    c.fill();
    c.restore();

    // 塔：由外往內畫，主塔最後畫在最前面
    const towers = [[-104, 18, 70, 48], [104, 18, 70, 48], [-58, 26, 108, 72], [58, 26, 108, 72], [0, 36, 156, 112]];
    for (const [dx, w, h, roofH] of towers) {
      const x = px + dx * k, tw = w * k, th = h * k, rh = roofH * k;
      const top = base - th;
      c.save();
      c.shadowColor = 'rgba(160,210,255,0.85)';
      c.shadowBlur = 12 * k;
      // 塔身：左亮右暗
      g = c.createLinearGradient(x - tw / 2, 0, x + tw / 2, 0);
      g.addColorStop(0, 'rgba(215,238,255,0.88)');
      g.addColorStop(0.5, 'rgba(160,205,250,0.76)');
      g.addColorStop(0.51, 'rgba(110,160,225,0.74)');
      g.addColorStop(1, 'rgba(85,130,200,0.74)');
      c.fillStyle = g;
      c.fillRect(x - tw / 2, top, tw, th);
      // 冰晶尖頂：左右兩個切面
      c.fillStyle = 'rgba(230,245,255,0.92)';
      c.beginPath();
      c.moveTo(x - tw * 0.65, top + 2 * k);
      c.lineTo(x, top - rh);
      c.lineTo(x, top + 2 * k);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(120,170,235,0.85)';
      c.beginPath();
      c.moveTo(x + tw * 0.65, top + 2 * k);
      c.lineTo(x, top - rh);
      c.lineTo(x, top + 2 * k);
      c.closePath();
      c.fill();
      c.restore();
      // 屋簷的亮線
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 1.4 * k;
      c.beginPath();
      c.moveTo(x - tw * 0.65, top + 2 * k);
      c.lineTo(x, top - rh);
      c.stroke();
      // 窗戶：小小的拱窗，微微亮著
      c.fillStyle = 'rgba(240,252,255,0.95)';
      const rows = Math.max(1, Math.floor(th / (34 * k)));
      for (let i = 0; i < rows; i++) {
        const wy = top + 16 * k + i * 30 * k;
        const ww = Math.max(3, tw * 0.22), wh = 11 * k;
        c.beginPath();
        c.moveTo(x - ww / 2, wy + wh);
        c.lineTo(x - ww / 2, wy + ww / 2);
        c.arc(x, wy + ww / 2, ww / 2, Math.PI, 0);
        c.lineTo(x + ww / 2, wy + wh);
        c.closePath();
        c.fill();
      }
      palaceTips.push({ x, y: top - rh });
    }
    // 牆腳的冰晶碎塊
    c.fillStyle = 'rgba(200,228,255,0.85)';
    [[-122, 14, 26], [-90, 9, 16], [92, 10, 18], [124, 14, 30], [-30, 7, 12], [34, 8, 14]].forEach(([dx, w, h]) => {
      const x = px + dx * k;
      c.beginPath();
      c.moveTo(x - w * k / 2, base);
      c.lineTo(x - w * k * 0.1, base - h * k);
      c.lineTo(x + w * k / 2, base);
      c.closePath();
      c.fill();
    });
  }

  /* ---------- 結冰的湖面：倒映對岸的松林與月亮，有冰裂紋和月光反射 ---------- */
  let lake = null; // { path, x0, x1, top, h }，動態層用來畫極光倒影和湖面閃光
  function frozenLake(c, r) {
    const cx = W * 0.24, cy = H * 0.748, rx = W * 0.2, ry = H * 0.03;
    const path = new Path2D();
    const nL = valueNoise(77);
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const wob = 1 + (nL(i * 0.35) - 0.5) * 0.12;
      const x = cx + Math.cos(a) * rx * wob, y = cy + Math.sin(a) * ry * wob;
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    path.closePath();
    const top = cy - ry;
    c.save();
    c.clip(path);
    // 底色：比天空深一點的藍
    let g = c.createLinearGradient(0, top, 0, cy + ry);
    g.addColorStop(0, '#2a4a80');
    g.addColorStop(1, '#1a3060');
    c.fillStyle = g;
    c.fillRect(cx - rx * 1.2, top - 4, rx * 2.4, ry * 2.4);
    // 倒影：把湖面上方的景物（對岸雪地、松林）上下翻轉畫進來
    c.save();
    c.globalAlpha = 0.42;
    c.translate(0, top * 2);
    c.scale(1, -1);
    c.drawImage(c.canvas, 0, 0, c.canvas.width, c.canvas.height, 0, 0, W, H);
    c.restore();
    c.fillStyle = 'rgba(30,55,105,0.35)';
    c.fillRect(cx - rx * 1.2, top - 4, rx * 2.4, ry * 2.4);
    // 月亮的倒影：一道往下拉長的光
    const mx = W * 0.15;
    radial(c, mx, cy, ry * 2.2, [[0, 'rgba(230,240,255,0.7)'], [0.4, 'rgba(200,220,255,0.3)'], [1, 'rgba(200,220,255,0)']], 0.22, 1);
    // 冰面上一道道橫向的月光反射
    c.strokeStyle = 'rgba(220,235,255,0.35)';
    c.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const y = top + r() * ry * 2;
      const x = cx + (r() - 0.5) * rx * 1.8;
      const len = (20 + r() * 90) * S;
      c.lineWidth = (0.8 + r() * 1.4) * S;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y + (r() - 0.5) * 2 * S); c.stroke();
    }
    // 冰裂紋
    c.strokeStyle = 'rgba(235,245,255,0.45)';
    c.lineWidth = 1 * S;
    for (let i = 0; i < 7; i++) {
      let x = cx + (r() - 0.5) * rx * 1.6, y = top + r() * ry * 2;
      c.beginPath();
      c.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += (r() - 0.3) * 40 * S;
        y += (r() - 0.5) * 10 * S;
        c.lineTo(x, y);
        if (r() < 0.35) { c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 24 * S, y + (r() - 0.5) * 8 * S); c.moveTo(x, y); }
      }
      c.stroke();
    }
    c.restore();
    // 湖岸的積雪
    c.strokeStyle = 'rgba(245,250,255,0.95)';
    c.lineWidth = 3 * S;
    c.stroke(path);
    c.strokeStyle = 'rgba(160,185,225,0.5)';
    c.lineWidth = 6 * S;
    c.save();
    c.clip(path);
    c.stroke(path);
    c.restore();
    lake = { path, x0: cx - rx, x1: cx + rx, top, h: ry * 2, mx };
  }

  function paintIce(c) {
    const r = mulberry(19);
    let g = c.createLinearGradient(0, 0, 0, H * 0.75);
    g.addColorStop(0, '#02060f');
    g.addColorStop(0.3, '#071431');
    g.addColorStop(0.58, '#12295a');
    g.addColorStop(0.82, '#26467c');
    g.addColorStop(1, '#3d6294');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    radial(c, W * 0.62, H * 0.7, W * 0.5, [[0, 'rgba(110,200,215,0.22)'], [1, 'rgba(110,200,215,0)']], 1, 0.4);

    // 銀河：沿著一條斜線分布的細小星點、光霧和暗塵
    const ax = W * 0.42, ay = -H * 0.05, bx = W * 1.02, by = H * 0.6;
    const len = Math.hypot(bx - ax, by - ay);
    const nx = -(by - ay) / len, ny = (bx - ax) / len;
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const t = r();
      const off = gauss(r) * H * 0.05;
      radial(c, ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off, H * (0.08 + r() * 0.08),
        [[0, r() < 0.5 ? 'rgba(130,120,220,0.09)' : 'rgba(110,160,235,0.09)'], [1, 'rgba(0,0,0,0)']]);
    }
    c.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 18; i++) {
      const t = r();
      const off = gauss(r) * H * 0.02;
      radial(c, ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off, H * (0.02 + r() * 0.035),
        [[0, 'rgba(3,7,20,0.35)'], [1, 'rgba(3,7,20,0)']], 2, 0.7);
    }
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 2600; i++) {
      const t = r();
      const off = gauss(r) * H * 0.07;
      c.globalAlpha = 0.15 + r() * 0.6;
      c.beginPath();
      c.arc(ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off, (0.3 + r() * 0.8) * S, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 380; i++) {
      c.globalAlpha = 0.2 + r() * 0.6;
      c.beginPath();
      c.arc(r() * W, r() * H * 0.62, (0.4 + r() * 1.1) * S, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // 月亮：大光暈、淡淡的月暈環、表面的陰影
    const mx = W * 0.15, my = H * 0.17, R = H * 0.052;
    radial(c, mx, my, R * 9, [[0, 'rgba(190,215,255,0.38)'], [0.25, 'rgba(160,195,255,0.12)'], [1, 'rgba(160,195,255,0)']]);
    radial(c, mx, my, R * 3.6, [[0, 'rgba(200,220,255,0)'], [0.82, 'rgba(200,220,255,0)'], [0.9, 'rgba(200,225,255,0.07)'], [1, 'rgba(200,220,255,0)']]);
    g = c.createRadialGradient(mx - R * 0.3, my - R * 0.3, R * 0.1, mx, my, R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.7, '#e9eefc');
    g.addColorStop(1, '#c9d5f0');
    c.fillStyle = g;
    c.beginPath();
    c.arc(mx, my, R, 0, Math.PI * 2);
    c.fill();
    [[0.3, -0.2, 0.22], [-0.25, 0.3, 0.16], [0.1, 0.45, 0.1], [-0.4, -0.25, 0.12]].forEach(([dx, dy, rr]) => {
      radial(c, mx + dx * R, my + dy * R, rr * R, [[0, 'rgba(140,160,200,0.28)'], [1, 'rgba(140,160,200,0)']]);
    });

    // 遠方雪山：月光照亮左側
    const baseY = H * 0.715;
    const back = { rockShade: '#2a4271', rockLit: '#4f6c9f', snowShade: '#7e95c1', snowLit: '#c9d8f2' };
    const front = { rockShade: '#223a68', rockLit: '#5b7bb0', snowShade: '#8ba2cf', snowLit: '#eef4ff' };
    const count = Math.max(4, Math.round(W / 280));
    for (let i = 0; i < count; i++) {
      snowPeak(c, W * ((i + 0.2) / count) + (r() - 0.5) * W * 0.06, H * (0.5 + r() * 0.06), W * (0.2 + r() * 0.1) + H * 0.2, baseY, r, back);
    }
    for (let i = 0; i < count; i++) {
      snowPeak(c, W * ((i + 0.7) / count) + (r() - 0.5) * W * 0.06, H * (0.56 + r() * 0.06), W * (0.16 + r() * 0.08) + H * 0.16, baseY, r, front);
    }
    g = c.createLinearGradient(0, H * 0.6, 0, baseY + H * 0.02);
    g.addColorStop(0, 'rgba(60,98,148,0)');
    g.addColorStop(1, 'rgba(70,110,160,0.85)');
    c.fillStyle = g;
    c.fillRect(0, H * 0.6, W, baseY - H * 0.58);

    const snowStrokes = { n: 1400, colors: ['#ffffff', '#b8c9e6', '#d8e4f6'], horizontal: true, alpha: 0.35 };
    hill(c, ridge.far, ['#b2c6e6', '#859ecb', '#6a84b6'], 'rgba(240,246,255,1)', r, { strokes: { ...snowStrokes, n: 600 } });
    palace(c);
    // 遠處雪地上的松林（比原本密：間距縮小、空地變少；冰宮前面留空，不擋住城堡）
    for (let x = -10; x < W + 10; x += (4 + r() * 9) * S) {
      if (fbm(nGrass, (x / W) * 6 + 3) < 0.36) continue;
      if (Math.abs(x - palaceX()) < 130 * S) continue;
      const h = (34 + r() * 50) * S;
      pine(c, x, ridge.far(x) + (6 + r() * 16) * S, h, '#cddbf3');
    }
    frozenLake(c, r);
    hill(c, ridge.mid, ['#cfdcf2', '#9fb3da', '#7f97c6'], 'rgba(250,252,255,1)', r, {
      shadows: { n: 5, color: 'rgba(60,85,140,0.3)' },
      strokes: { ...snowStrokes, n: 1200 },
    });
    // 中間雪地上零星的大松樹，三五成群
    for (let i = 0; i < 7; i++) {
      const cx = r() * W;
      const k = 1 + Math.floor(r() * 3);
      for (let j = 0; j < k; j++) {
        const x = cx + (j - (k - 1) / 2) * 34 * S + (r() - 0.5) * 12 * S;
        pine(c, x, ridge.mid(x) + (8 + r() * 10) * S, (64 + r() * 66) * S, '#e3ecfb');
      }
    }
    hill(c, ridge.near, ['#eef3fc', '#c3d2ec', '#9db1d8'], 'rgba(255,255,255,1)', r, {
      shadows: { n: 6, color: 'rgba(70,95,150,0.28)' },
      strokes: { ...snowStrokes, n: 700 },
    });
  }

  /* ---------- 動態層 ---------- */
  let clouds = [], sparkles = [], blades = [], tufts = [], daisies = [], drift = null, curtain = null;
  const GRASS_COLS = ['#24662a', '#357f32', '#4c9a3c', '#6db84c', '#8fcc5e'];
  let meteor = null, nextMeteor = 4;

  function makeCurtain() {
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 256;
    const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(170,120,255,0)');
    grd.addColorStop(0.35, 'rgba(130,150,255,0.35)');
    grd.addColorStop(0.75, 'rgba(110,240,200,0.85)');
    grd.addColorStop(0.92, 'rgba(160,255,220,1)');
    grd.addColorStop(1, 'rgba(160,255,220,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 256);
    return cv;
  }

  function buildDynamic() {
    const r = mulberry(101);
    const nClouds = Math.max(3, Math.round(W / 380));
    clouds = Array.from({ length: nClouds }, (_, i) => {
      const w = H * (0.14 + r() * 0.16);
      const s = cloudSprite(w, r, CLOUD_DAY);
      return { s, x: (i / nClouds) * W * 1.1 + r() * W * 0.1, y: H * (0.1 + r() * 0.3), v: (3 + r() * 6) * S };
    });
    sparkles = Array.from({ length: 70 }, () => {
      const x = r() * W;
      const top = r() < 0.6 ? ridge.near(x) : ridge.mid(x);
      return { x, y: top + r() * (H - top) * 0.8 + 4 * S, s: (2 + r() * 3.5) * S, ph: r() * 10, tw: 0.6 + r() * 1.6 };
    });
    // 冰宮塔尖的閃光（比較大、比較常閃）
    palaceTips.forEach((p) => sparkles.push({ x: p.x, y: p.y, s: (7 + r() * 4) * S, ph: r() * 10, tw: 0.9 + r() * 0.8, soft: true }));
    // 湖面上，月光倒影附近的閃光
    if (lake) {
      for (let i = 0; i < 16; i++) {
        sparkles.push({ x: lake.mx + gauss(r) * W * 0.03, y: lake.top + r() * lake.h * 0.9, s: (1.6 + r() * 2.4) * S, ph: r() * 10, tw: 1.2 + r() * 1.8 });
      }
    }
    // 前景的草：依顏色分組，每一組一次填色
    const cols = GRASS_COLS;
    blades = cols.map(() => []);
    for (let x = -10; x < W + 10; x += (2.4 + r() * 2.6) * S) {
      const tall = 0.5 + fbm(nGrass, (x / W) * 7) * 1.1;
      const h = (16 + r() * 56) * S * tall;
      const ci = Math.min(cols.length - 1, Math.floor(r() * cols.length * (0.55 + h / (90 * S) * 0.5)));
      blades[ci].push({ x, y: H + 2, h, w: (2 + r() * 2.4) * S, lean: (r() - 0.45) * 0.5, ph: r() * 6 });
    }
    // 遠處與中間山丘上的高草叢：一片一片長在山丘頂端，遠的偏淡（空氣透視）
    const tuftCols = [['#5f9c55', '#7cb766', '#9fcf7c', '#c0e08f'], ['#3f8436', '#5ea445', '#86c255', '#b5dd7a']];
    tufts = tuftCols.map((c) => c.map(() => []));
    tufts.cols = tuftCols;
    [['far', 0, 12, 0.5], ['mid', 1, 9, 0.85]].forEach(([layer, li, step, scale]) => {
      const fn = ridge[layer];
      for (let x = -10; x < W + 10; x += (step + r() * step) * S) {
        if (fbm(nGrass, (x / W) * 4 + li * 9 + 1) < 0.44) continue; // 空出一些地方，草叢才會一片一片
        const n = 6 + Math.floor(r() * 8);
        const by = fn(x) + (4 + r() * (layer === 'far' ? 18 : 36)) * S;
        if (onFlowerBed(layer, x, by)) continue; // 花圃上不長高草
        const big = (layer === 'far' ? 18 : 34) * S * (0.7 + r() * 0.7);
        for (let k = 0; k < n; k++) {
          const off = (k / (n - 1) - 0.5);
          const h = big * (0.55 + (1 - Math.abs(off) * 1.4) * 0.6 + r() * 0.2);
          const ci = Math.min(3, Math.floor(r() * 2 + (h / big) * 1.6));
          tufts[li][ci].push({ x: x + off * big * 0.9, y: by, h, w: (1 + r() * 1.2) * S * scale * 1.3, lean: off * 0.9 + (r() - 0.5) * 0.2, ph: r() * 6 });
        }
      }
    });
    daisies = Array.from({ length: Math.round(W / 140) }, () => ({ x: r() * W, h: (40 + r() * 50) * S, ph: r() * 6, s: (4 + r() * 3) * S, col: r() < 0.6 ? '#fffdf2' : '#ffe36b' }));
    // 前景的積雪
    drift = new Path2D();
    drift.moveTo(0, H);
    for (let x = 0; x <= W + 10; x += 10) {
      drift.lineTo(x, H - (30 + 34 * fbm(nGrass, (x / W) * 4 + 20)) * S);
    }
    drift.lineTo(W, H);
    drift.closePath();
    curtain = makeCurtain();
  }

  function drawSky(c, t, dt, mix) {
    if (mix.meadow > 0.01) {
      c.globalAlpha = mix.meadow;
      for (const k of clouds) {
        k.x += k.v * dt;
        if (k.x - k.s.w / 2 > W) k.x = -k.s.w / 2;
        c.drawImage(k.s.cv, k.x - k.s.w / 2, k.y - k.s.baseY);
      }
      const wind = 0.9 + Math.sin(t * 0.23) * 0.5 + Math.sin(t * 0.61) * 0.3;
      tufts.forEach((layer, li) => layer.forEach((list, ci) => drawBlades(c, list, tufts.cols[li][ci], t, wind * (li ? 0.9 : 0.7))));
      c.globalAlpha = 1;
    }
    if (mix.ice > 0.01) {
      // 極光：一條條半透明的光幕，隨時間慢慢起伏
      c.globalCompositeOperation = 'lighter';
      const step = Math.max(4, 5 * S);
      for (let x = 0; x < W; x += step) {
        const u = x / W;
        const base = H * (0.33 + 0.06 * Math.sin(u * 4 + t * 0.12) + 0.03 * Math.sin(u * 11 - t * 0.23));
        const h = H * (0.16 + 0.09 * (0.5 + 0.5 * Math.sin(u * 13 + t * 0.35)));
        const a = (0.5 + 0.5 * Math.sin(u * 6.5 + t * 0.18)) * (0.4 + 0.6 * Math.min(1, u * 1.6)) * 0.11;
        c.globalAlpha = a * mix.ice;
        c.drawImage(curtain, x - step / 2, base - h, step * 2, h);
      }
      // 湖面上的極光倒影：同一道極光在冰面上淡淡地流動
      if (lake) {
        c.save();
        c.clip(lake.path);
        for (let x = lake.x0; x < lake.x1; x += step) {
          const u = x / W;
          const a = (0.5 + 0.5 * Math.sin(u * 6.5 + t * 0.18)) * (0.4 + 0.6 * Math.min(1, u * 1.6)) * 0.22;
          c.globalAlpha = a * mix.ice;
          c.save();
          c.translate(0, lake.top);
          c.scale(1, -1);
          c.drawImage(curtain, x - step / 2, -lake.h * 1.3, step * 2, lake.h * 1.3);
          c.restore();
        }
        c.restore();
      }
      c.globalCompositeOperation = 'source-over';

      // 流星
      nextMeteor -= dt;
      if (!meteor && nextMeteor <= 0) {
        meteor = { x: W * (0.35 + Math.random() * 0.55), y: H * (0.04 + Math.random() * 0.2), life: 0, ttl: 0.9, ang: Math.PI * (0.78 + Math.random() * 0.1) };
        nextMeteor = 5 + Math.random() * 8;
      }
      if (meteor) {
        meteor.life += dt;
        const k = meteor.life / meteor.ttl;
        const d = H * 0.5 * k;
        const hx = meteor.x + Math.cos(meteor.ang) * d, hy = meteor.y + Math.sin(meteor.ang) * d;
        const tail = H * 0.14;
        const tx = hx - Math.cos(meteor.ang) * tail, ty = hy - Math.sin(meteor.ang) * tail;
        const grd = c.createLinearGradient(hx, hy, tx, ty);
        grd.addColorStop(0, 'rgba(255,255,255,0.95)');
        grd.addColorStop(1, 'rgba(180,210,255,0)');
        c.globalAlpha = mix.ice * Math.sin(Math.PI * Math.min(1, k));
        c.strokeStyle = grd;
        c.lineWidth = 2 * S;
        c.lineCap = 'round';
        c.beginPath(); c.moveTo(hx, hy); c.lineTo(tx, ty); c.stroke();
        if (k >= 1) meteor = null;
      }

      // 雪地上的閃光
      c.fillStyle = '#ffffff';
      for (const p of sparkles) {
        const a = Math.pow(Math.max(0, Math.sin(t * p.tw + p.ph)), 10);
        if (a < 0.02) continue;
        c.globalAlpha = a * mix.ice;
        const s = p.s * (0.6 + a * 0.6);
        c.beginPath();
        c.moveTo(p.x, p.y - s); c.lineTo(p.x + s * 0.18, p.y - s * 0.18); c.lineTo(p.x + s, p.y);
        c.lineTo(p.x + s * 0.18, p.y + s * 0.18); c.lineTo(p.x, p.y + s); c.lineTo(p.x - s * 0.18, p.y + s * 0.18);
        c.lineTo(p.x - s, p.y); c.lineTo(p.x - s * 0.18, p.y - s * 0.18);
        c.closePath();
        c.fill();
      }
      c.globalAlpha = 1;
    }
  }

  // 一組同顏色的草葉一次畫完：底部固定，尖端隨風擺動
  function drawBlades(c, list, color, t, wind) {
    c.fillStyle = color;
    c.beginPath();
    for (const b of list) {
      const sway = (Math.sin(t * 1.5 + b.x * 0.006 + b.ph) * 0.6 + Math.sin(t * 2.7 + b.x * 0.013) * 0.4) * b.h * 0.14 * wind;
      const tx = b.x + b.lean * b.h + sway, ty = b.y - b.h;
      const mx = b.x + (tx - b.x) * 0.35;
      c.moveTo(b.x - b.w, b.y);
      c.quadraticCurveTo(mx - b.w * 0.4, b.y - b.h * 0.5, tx, ty);
      c.quadraticCurveTo(mx + b.w * 0.4, b.y - b.h * 0.5, b.x + b.w, b.y);
    }
    c.fill();
  }

  // 前景：草隨風擺動（草木）、積雪（冰雪），畫在信箱前面
  function drawFront(c, t, mix, wind, calm) {
    c.clearRect(0, 0, W, H);
    const amp = calm ? 0.25 : 1;
    if (mix.meadow > 0.01) {
      c.globalAlpha = mix.meadow;
      blades.forEach((list, ci) => drawBlades(c, list, GRASS_COLS[ci], t, wind * amp));
      for (const d of daisies) {
        const sway = Math.sin(t * 1.4 + d.ph) * d.h * 0.12 * wind * amp;
        const tx = d.x + sway, ty = H - d.h;
        c.strokeStyle = '#3f8a36';
        c.lineWidth = 2 * S;
        c.beginPath(); c.moveTo(d.x, H + 2); c.quadraticCurveTo(d.x, H - d.h * 0.5, tx, ty); c.stroke();
        c.fillStyle = d.col;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          c.beginPath(); c.arc(tx + Math.cos(a) * d.s, ty + Math.sin(a) * d.s * 0.8, d.s * 0.6, 0, Math.PI * 2); c.fill();
        }
        c.fillStyle = '#f2a83b';
        c.beginPath(); c.arc(tx, ty, d.s * 0.5, 0, Math.PI * 2); c.fill();
      }
    }
    if (mix.ice > 0.01) {
      c.globalAlpha = mix.ice;
      const g = c.createLinearGradient(0, H - 70 * S, 0, H);
      g.addColorStop(0, '#f4f8ff');
      g.addColorStop(1, '#b8c9e8');
      c.fillStyle = g;
      c.fill(drift);
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 2.5 * S;
      c.stroke(drift);
    }
    c.globalAlpha = 1;
  }

  let canvases = null;
  function resize(w, h, dpr, els) {
    W = w; H = h; DPR = Math.min(1.5, dpr); S = Math.max(0.55, H / 1080);
    canvases = els;
    [[els.meadow, paintMeadow], [els.ice, paintIce]].forEach(([cv, paint]) => {
      cv.width = Math.round(W * DPR);
      cv.height = Math.round(H * DPR);
      const c = cv.getContext('2d');
      c.setTransform(DPR, 0, 0, DPR, 0, 0);
      paint(c);
    });
    const fdpr = Math.min(2, dpr);
    els.front.width = Math.round(W * fdpr);
    els.front.height = Math.round(H * fdpr);
    els.front.getContext('2d').setTransform(fdpr, 0, 0, fdpr, 0, 0);
    buildDynamic();
  }

  return { resize, drawSky, drawFront };
})();
