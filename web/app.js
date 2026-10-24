/* 衣橱 · 穿搭记录 */
(() => {
  'use strict';

  const CATS = [
    { key: 'outerwear', label: '外套' },
    { key: 'top', label: '上衣' },
    { key: 'bottom', label: '下装' },
    { key: 'shoes', label: '鞋' },
    { key: 'accessory', label: '配饰' },
  ];
  const CAT_LABEL = Object.fromEntries(CATS.map((c) => [c.key, c.label]));
  const SEASONS = ['春', '夏', '秋', '冬'];
  const SLEEVES = [
    { key: 'short', label: '短袖' },
    { key: 'long', label: '长袖' },
  ];
  const SLEEVE_LABEL = Object.fromEntries(SLEEVES.map((s) => [s.key, s.label]));

  const COLOR_HEX = {
    白: '#f4f3ee', 米: '#e4dac3', 米白: '#eee9dc', 黑: '#242422', 灰: '#9aa19e',
    深灰: '#5f6663', 红: '#b9412f', 酒红: '#7c2f35', 粉: '#e3a8b4', 蓝: '#3f6f9e',
    藏蓝: '#2b3b55', 牛仔: '#5878a5', 天蓝: '#8fb7d6', 绿: '#4f7a5a',
    军绿: '#5b644a', 墨绿: '#2f4f3f', 卡其: '#b9a176', 棕: '#7a5230',
    咖啡: '#5c4433', 焦糖: '#a9713f', 黄: '#d8b23f', 橙: '#cf7a3b',
    紫: '#6b4f8a', 银: '#c7cacb', 金: '#c2a35a', 透明: 'rgba(255,255,255,.4)',
  };

  const SERIF = '"Songti SC","STSong","Source Han Serif SC","Noto Serif CJK SC",SimSun,serif';
  const SANS = '"PingFang SC","Microsoft YaHei",system-ui,sans-serif';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const view = $('#view');
  const modalRoot = $('#modal-root');
  const toastEl = $('#toast');
  const state = { items: [], counts: {}, filter: { category: 'all', q: '', season: '', sleeve: '' } };

  /* ---------------- 工具 ---------------- */

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function splitList(value) {
    return String(value || '')
      .split(/[,，、/;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const fmtDate = (s) => (s ? String(s).slice(0, 10) : '');
  const pct = (n) => Math.round(n * 100) / 100;
  const chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };
  const colorHex = (name) => COLOR_HEX[String(name || '').trim()] || '#d8d8cf';

  function toast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.classList.toggle('is-error', !!isError);
    toastEl.classList.add('is-show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toastEl.classList.remove('is-show'), 2600);
  }

  async function api(path, options = {}) {
    const init = { ...options };
    if (init.body) init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    const res = await fetch(path, init);
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) throw new Error((data && data.error) || `请求失败（${res.status}）`);
    return data;
  }

  /* ---------------- 弹窗 ---------------- */

  function openModal({ title, wide = false, onClose = null }) {
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal${wide ? ' modal--wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="modal-head">
            <h2>${esc(title)}</h2>
            <button class="icon-btn" type="button" data-close aria-label="关闭">×</button>
          </div>
          <div class="modal-body"></div>
          <div class="modal-foot"></div>
        </div>
      </div>`;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      modalRoot.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const backdrop = $('.modal-backdrop', modalRoot);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    $('[data-close]', modalRoot).addEventListener('click', close);
    return {
      close,
      body: $('.modal-body', modalRoot),
      foot: $('.modal-foot', modalRoot),
    };
  }

  function confirmDialog({ title, message, confirmLabel = '删除', danger = true }) {
    return new Promise((resolve) => {
      let answered = false;
      const modal = openModal({
        title,
        onClose: () => { if (!answered) resolve(false); },
      });
      modal.body.innerHTML = `<p class="confirm-text">${esc(message)}</p>`;
      modal.foot.innerHTML = `
        <button class="btn" type="button" data-no>取消</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-yes>${esc(confirmLabel)}</button>`;
      $('[data-no]', modal.foot).addEventListener('click', () => { answered = true; resolve(false); modal.close(); });
      $('[data-yes]', modal.foot).addEventListener('click', () => { answered = true; resolve(true); modal.close(); });
    });
  }

  /* ---------------- 图片 ---------------- */

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type || !file.type.startsWith('image/')) {
        return reject(new Error('请选择图片文件'));
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        let width = img.naturalWidth;
        let height = img.naturalHeight;
        const scale = Math.min(1, max / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('这张图片读不出来，换一张试试'));
      };
      img.src = url;
    });
  }

  const imageCache = new Map();
  function loadImage(src) {
    if (!imageCache.has(src)) {
      imageCache.set(src, new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = src;
      }));
    }
    return imageCache.get(src);
  }

  /* ---------------- 拼贴布局 ---------------- */

  const ASPECT = 0.8; // 版面 4:5，正方形在百分比空间里的高宽比

  function groupByCategory(items) {
    const groups = { outerwear: [], top: [], bottom: [], shoes: [], accessory: [] };
    (items || []).forEach((item) => {
      if (groups[item.category]) groups[item.category].push(item);
    });
    return groups;
  }

  function rotFor(i, base = 0) {
    const seq = [-2.4, 1.8, -1.1, 2.6, -3.1, 1.2, -1.8];
    return seq[(i + base) % seq.length];
  }

  function splitRow(items, x, y, w, h, gap = 2) {
    const n = items.length;
    if (!n) return [];
    const cellW = (w - gap * (n - 1)) / n;
    return items.map((item, i) => ({
      item, x: x + i * (cellW + gap), y, w: cellW, h,
    }));
  }

  function layoutFlat(items, withTitle) {
    const g = groupByCategory(items);
    const slots = [];
    let cursor = withTitle ? 13.5 : 3;

    if (g.accessory.length) {
      chunk(g.accessory, 6).forEach((row) => {
        const n = row.length;
        const gap = 2;
        const w = Math.min(15, (82 - gap * (n - 1)) / n);
        const total = n * w + gap * (n - 1);
        const startX = (100 - total) / 2;
        const h = Math.min(w * ASPECT, 11.5);
        row.forEach((item, i) => {
          slots.push({ item, x: startX + i * (w + gap), y: cursor, w, h, rot: rotFor(i), z: 6 });
        });
        cursor += h + 2;
      });
      cursor += 1.5;
    }

    const bottomLimit = 96;
    const avail = Math.max(30, bottomLimit - cursor);
    const hTop = avail * 0.42;
    const hBottom = avail * 0.31;
    const hShoes = avail * 0.17;
    const vGap = avail * 0.035;
    const topY = cursor;
    const bottomY = topY + hTop + vGap;
    const shoesY = bottomY + hBottom + vGap;

    const outer = g.outerwear;
    const tops = g.top;

    if (outer.length && tops.length) {
      splitRow(outer, 6, topY, 39, hTop).forEach((s, i) => slots.push({ ...s, rot: rotFor(i), z: 1 }));
      splitRow(tops, 48, topY + 0.8, 42, hTop - 0.8).forEach((s, i) => slots.push({ ...s, rot: rotFor(i, 2), z: 2 }));
    } else if (outer.length) {
      splitRow(outer, 20, topY, 60, hTop).forEach((s, i) => slots.push({ ...s, rot: rotFor(i), z: 1 }));
    } else if (tops.length) {
      splitRow(tops, 18, topY, 64, hTop).forEach((s, i) => slots.push({ ...s, rot: rotFor(i), z: 2 }));
    }

    if (g.bottom.length) {
      splitRow(g.bottom, 28, bottomY, 44, hBottom).forEach((s, i) => slots.push({ ...s, rot: rotFor(i, 1), z: 1 }));
    }
    if (g.shoes.length) {
      splitRow(g.shoes, 33, shoesY, 34, hShoes).forEach((s, i) => slots.push({ ...s, rot: rotFor(i, 3), z: 1 }));
    }

    return slots;
  }

  function layoutMannequin(items, withTitle) {
    const g = groupByCategory(items);
    const slots = [];
    const upperY = withTitle ? 17 : 6;
    const upperH = 28;
    const bottomY = upperY + upperH + 2;
    const bottomH = 21;
    const shoesY = bottomY + bottomH + 3;
    const shoesH = 10;

    if (g.outerwear.length && g.top.length) {
      splitRow(g.outerwear, 25, upperY, 35, upperH).forEach((s, i) => slots.push({ ...s, rot: rotFor(i), z: 1 }));
      splitRow(g.top, 41, upperY + 4, 33, upperH - 3).forEach((s, i) => slots.push({ ...s, rot: rotFor(i, 1), z: 2 }));
    } else if (g.outerwear.length) {
      splitRow(g.outerwear, 32, upperY, 36, upperH).forEach((s, i) => slots.push({ ...s, rot: rotFor(i), z: 1 }));
    } else if (g.top.length) {
      splitRow(g.top, 33, upperY + 1, 34, upperH - 2).forEach((s, i) => slots.push({ ...s, rot: rotFor(i), z: 2 }));
    }

    if (g.bottom.length) {
      splitRow(g.bottom, 36, bottomY, 28, bottomH).forEach((s, i) => slots.push({ ...s, rot: rotFor(i, 2), z: 1 }));
    }
    if (g.shoes.length) {
      splitRow(g.shoes, 40, shoesY, 20, shoesH).forEach((s, i) => slots.push({ ...s, rot: rotFor(i, 3), z: 1 }));
    }

    const perSide = Math.ceil(g.accessory.length / 2);
    g.accessory.forEach((item, i) => {
      const isRight = i < perSide;
      const idx = isRight ? i : i - perSide;
      const count = isRight ? perSide : g.accessory.length - perSide;
      const w = 13;
      const h = 10.5;
      const gap = 1.5;
      const total = count * h + (count - 1) * gap;
      const startY = upperY + Math.max(0, (upperH - total) / 2);
      slots.push({
        item,
        x: isRight ? 94 - w : 6,
        y: startY + idx * (h + gap),
        w, h, rot: rotFor(i), z: 1,
      });
    });

    return slots;
  }

  const MANNEQUIN_SHAPES = [
    { kind: 'circle', cx: 100, cy: 36, r: 18 },
    { kind: 'path', d: 'M100 54 L100 62' },
    { kind: 'path', d: 'M100 62 C76 62 63 76 61 96 L57 148 C56 174 61 194 70 207 L100 217 L130 207 C139 194 144 174 143 148 L139 96 C137 76 124 62 100 62 Z' },
    { kind: 'path', d: 'M76 212 L74 250 M124 212 L126 250' },
    { kind: 'path', d: 'M100 217 L100 306' },
    { kind: 'path', d: 'M62 330 L138 330' },
    { kind: 'path', d: 'M100 306 L100 330' },
  ];

  function mannequinSvg() {
    const shapes = MANNEQUIN_SHAPES.map((s) => (
      s.kind === 'circle'
        ? `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>`
        : `<path d="${s.d}"/>`
    )).join('');
    return `<svg class="mannequin" viewBox="0 0 200 360" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
  }

  function slotMarkup(slot) {
    const item = slot.item;
    const inner = item.image
      ? `<img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy">`
      : `<span class="slot-fallback">${esc(CAT_LABEL[item.category] || '')}</span>`;
    return `<figure class="slot" style="left:${pct(slot.x)}%;top:${pct(slot.y)}%;width:${pct(slot.w)}%;height:${pct(slot.h)}%;--rot:${slot.rot}deg;z-index:${slot.z || 1}">${inner}</figure>`;
  }

  function boardMarkup(outfit, { mode = 'flat', mini = false, withTitle = false } = {}) {
    const items = outfit.items || [];
    const slots = mode === 'mannequin' ? layoutMannequin(items, withTitle) : layoutFlat(items, withTitle);
    const title = withTitle
      ? `<div class="board-title"><h2>${esc(outfit.name)}</h2>${outfit.occasion ? `<span>${esc(outfit.occasion)}</span>` : ''}</div><div class="board-rule"></div>`
      : '';
    return `<div class="board${mini ? ' board--mini' : ''} board--${mode}">
      ${mode === 'mannequin' ? mannequinSvg() : ''}
      ${title}
      ${slots.map(slotMarkup).join('')}
    </div>`;
  }

  /* ---------------- 导出图片 ---------------- */

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBackground(ctx, W, H) {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#EAE5D8');
    grad.addColorStop(1, '#DDD6C5');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(118,106,84,.07)';
    for (let x = 0; x < W; x += 9) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(118,106,84,.05)';
    for (let y = 0; y < H; y += 9) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawTitle(ctx, outfit, W, H) {
    const x = W * 0.055;
    const maxW = W * 0.6;
    let size = 58;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${size}px ${SERIF}`;
    while (ctx.measureText(outfit.name).width > maxW && size > 28) {
      size -= 2;
      ctx.font = `600 ${size}px ${SERIF}`;
    }
    ctx.fillStyle = '#1D2A23';
    ctx.fillText(outfit.name, x, H * 0.073);
    if (outfit.occasion) {
      ctx.font = `500 22px ${SANS}`;
      ctx.fillStyle = 'rgba(46,91,73,.92)';
      ctx.textAlign = 'right';
      ctx.fillText(outfit.occasion, W - x, H * 0.069);
    }
    ctx.strokeStyle = 'rgba(29,42,35,.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, H * 0.099);
    ctx.lineTo(W - x, H * 0.099);
    ctx.stroke();
  }

  function drawMannequin(ctx, W, H) {
    const scale = Math.min((W * 0.46) / 200, (H * 0.78) / 360);
    ctx.save();
    ctx.translate(W * 0.5 - 100 * scale, H * 0.12);
    ctx.scale(scale, scale);
    ctx.strokeStyle = 'rgba(29,42,35,.32)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    MANNEQUIN_SHAPES.forEach((s) => {
      if (s.kind === 'circle') {
        ctx.beginPath();
        ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.stroke(new Path2D(s.d));
      }
    });
    ctx.restore();
  }

  function drawSlot(ctx, slot, img, W, H) {
    const x = (slot.x / 100) * W;
    const y = (slot.y / 100) * H;
    const w = (slot.w / 100) * W;
    const h = (slot.h / 100) * H;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(((slot.rot || 0) * Math.PI) / 180);
    const radius = Math.min(w, h) * 0.05;
    ctx.shadowColor = 'rgba(38,36,26,.2)';
    ctx.shadowBlur = Math.min(w, h) * 0.13;
    ctx.shadowOffsetY = Math.min(w, h) * 0.05;
    roundRect(ctx, -w / 2, -h / 2, w, h, radius);
    ctx.fillStyle = '#FCFCF8';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    const pad = Math.min(w, h) * 0.06;
    if (img) {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const scale = Math.min((w - pad * 2) / iw, (h - pad * 2) / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    } else {
      ctx.fillStyle = 'rgba(29,42,35,.4)';
      ctx.font = `400 ${Math.max(14, Math.min(w, h) * 0.13)}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CAT_LABEL[slot.item.category] || '', 0, 0);
    }
    ctx.restore();
  }

  async function exportBoard(outfit, mode) {
    const W = 1080;
    const H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    drawBackground(ctx, W, H);
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch { /* 忽略 */ }
    }
    drawTitle(ctx, outfit, W, H);
    if (mode === 'mannequin') drawMannequin(ctx, W, H);
    const slots = mode === 'mannequin'
      ? layoutMannequin(outfit.items || [], true)
      : layoutFlat(outfit.items || [], true);
    const images = await Promise.all(
      slots.map((s) => (s.item.image ? loadImage(s.item.image).catch(() => null) : Promise.resolve(null)))
    );
    slots.forEach((slot, i) => drawSlot(ctx, slot, images[i], W, H));

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      toast('导出失败，请重试', true);
      return;
    }
    const name = String(outfit.name || '搭配').replace(/[\\/:*?"<>|]/g, '').trim() || '搭配';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${name}-${fmtDate(new Date().toISOString())}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 3000);
    toast('搭配图已导出');
  }

  /* ---------------- 衣橱 ---------------- */

  function metaLine(item) {
    const parts = [];
    if (item.color) {
      parts.push(`<span class="dot" style="background:${colorHex(item.color)}"></span>${esc(item.color)}`);
    }
    const seasons = splitList(item.seasons);
    if (seasons.length) parts.push(esc(seasons.join(' ')));
    if (SLEEVE_LABEL[item.sleeve]) parts.push(esc(SLEEVE_LABEL[item.sleeve]));
    if (!parts.length) parts.push('未填写颜色');
    return parts.join(' <span aria-hidden="true">·</span> ');
  }

  function itemCard(item) {
    const photo = item.image
      ? `<img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy">`
      : `<span class="photo-fallback">${esc(CAT_LABEL[item.category] || '衣')}</span>`;
    return `<a class="item-card" href="#/item/${item.id}">
      <div class="item-photo">${photo}</div>
      <div class="item-info">
        <span class="fabric-tag">${esc(CAT_LABEL[item.category] || '其他')}</span>
        <h3 class="item-name">${esc(item.name)}</h3>
        <p class="item-meta">${metaLine(item)}</p>
      </div>
    </a>`;
  }

  async function renderWardrobe() {
    view.innerHTML = `<p class="lede">正在打开衣橱…</p>`;
    const [itemsData, stats] = await Promise.all([api('/api/items'), api('/api/stats')]);
    state.items = itemsData.items;
    state.counts = stats.counts;

    const chips = [
      { key: 'all', label: '全部', n: stats.items },
      ...CATS.map((c) => ({ key: c.key, label: c.label, n: stats.counts[c.key] || 0 })),
    ];

    view.innerHTML = `
      <header class="page-head">
        <div>
          <h1 class="page-title">衣橱</h1>
          <p class="lede"><b>${stats.items}</b> 件单品 · <b>${stats.own_outfits}</b> 套穿搭${stats.reference_outfits ? ` · <b>${stats.reference_outfits}</b> 条参考` : ''}</p>
        </div>
        <button class="btn btn-primary" type="button" id="add-item">＋ 添加单品</button>
      </header>
      <div class="toolbar">
        <div class="chips" id="cat-chips">
          ${chips.map((c) => `<button class="chip${state.filter.category === c.key ? ' is-active' : ''}" type="button" data-cat="${c.key}">${c.label}<small>${c.n}</small></button>`).join('')}
        </div>
        <div class="toolbar-right">
          <select class="select" id="season-filter" aria-label="按季节筛选">
            <option value="">全部季节</option>
            ${SEASONS.map((s) => `<option value="${s}"${state.filter.season === s ? ' selected' : ''}>${s}季</option>`).join('')}
          </select>
          <select class="select" id="sleeve-filter" aria-label="按袖长筛选">
            <option value="">全部袖长</option>
            ${SLEEVES.map((s) => `<option value="${s.key}"${state.filter.sleeve === s.key ? ' selected' : ''}>${s.label}</option>`).join('')}
          </select>
          <input class="search" id="search-input" type="search" placeholder="搜名称、颜色、标签" value="${esc(state.filter.q)}">
        </div>
      </div>
      <div id="item-grid"></div>`;

    const grid = $('#item-grid');

    const paintGrid = () => {
      const q = state.filter.q.trim().toLowerCase();
      const list = state.items.filter((item) => {
        if (state.filter.category !== 'all' && item.category !== state.filter.category) return false;
        if (state.filter.season && !item.seasons.includes(state.filter.season)) return false;
        if (state.filter.sleeve && item.sleeve !== state.filter.sleeve) return false;
        if (!q) return true;
        const hay = [item.name, item.color, item.tags, item.notes].join(' ').toLowerCase();
        return hay.includes(q);
      });
      grid.innerHTML = list.length
        ? `<div class="item-grid">${list.map(itemCard).join('')}</div>`
        : `<div class="empty">
             <h2>${state.items.length ? '没有符合条件的单品' : '衣橱还是空的'}</h2>
             <p>${state.items.length ? '换个类别或关键词看看。' : '先添加一件上衣、裤子或鞋子，之后就能组合成搭配。'}</p>
             <button class="btn btn-primary" type="button" id="empty-add">＋ 添加单品</button>
           </div>`;
      const emptyAdd = $('#empty-add', grid);
      if (emptyAdd) emptyAdd.addEventListener('click', () => openItemForm());
    };

    $('#cat-chips').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      state.filter.category = btn.dataset.cat;
      $$('#cat-chips .chip').forEach((chip) => chip.classList.toggle('is-active', chip === btn));
      paintGrid();
    });

    $('#search-input').addEventListener('input', (e) => {
      state.filter.q = e.target.value;
      paintGrid();
    });

    $('#season-filter').addEventListener('change', (e) => {
      state.filter.season = e.target.value;
      paintGrid();
    });

    $('#sleeve-filter').addEventListener('change', (e) => {
      state.filter.sleeve = e.target.value;
      paintGrid();
    });

    $('#add-item').addEventListener('click', () => openItemForm());
    paintGrid();
  }

  /* ---------------- 单品详情 ---------------- */

  async function renderItemDetail(id) {
    view.innerHTML = `<p class="lede">载入中…</p>`;
    const item = await api(`/api/items/${id}`);
    const photo = item.image
      ? `<img src="${esc(item.image)}" alt="${esc(item.name)}">`
      : `<span class="photo-fallback">${esc(CAT_LABEL[item.category] || '衣')}</span>`;

    const facts = [
      ['颜色', item.color || '—'],
      ['季节', splitList(item.seasons).join('、') || '—'],
    ];
    if (item.category === 'top' || item.category === 'outerwear') {
      facts.push(['袖长', SLEEVE_LABEL[item.sleeve] || '—']);
    }
    facts.push(
      ['标签', splitList(item.tags).join('、') || '—'],
      ['备注', item.notes || '—'],
      ['入库', fmtDate(item.created_at) || '—']
    );

    const related = item.outfits && item.outfits.length
      ? `<div class="outfit-grid">${item.outfits.map(outfitMiniCard).join('')}</div>`
      : `<p class="lede">这件单品还没有用进任何搭配。</p>`;

    view.innerHTML = `
      <div class="detail-head">
        <a class="back-link" href="#/wardrobe">← 返回衣橱</a>
        <div class="actions">
          <button class="btn" type="button" id="edit-item">编辑</button>
          <button class="btn btn-danger" type="button" id="delete-item">删除</button>
        </div>
      </div>
      <div class="item-detail">
        <div class="item-detail-photo">${photo}</div>
        <div>
          <span class="fabric-tag">${esc(CAT_LABEL[item.category] || '其他')}</span>
          <h1 class="detail-title">${esc(item.name)}</h1>
          <dl class="facts">
            ${facts.map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}
          </dl>
        </div>
      </div>
      <section class="related">
        <div class="side-heading"><h2>出现在这些搭配里</h2><span>${item.outfits ? item.outfits.length : 0} 套</span></div>
        ${related}
      </section>`;

    $('#edit-item').addEventListener('click', () => openItemForm(item));
    $('#delete-item').addEventListener('click', async () => {
      const count = item.outfits ? item.outfits.length : 0;
      const ok = await confirmDialog({
        title: '删除单品',
        message: `确定删除「${item.name}」吗？${count ? `\n它同时会从 ${count} 套搭配中移除。` : ''}`,
      });
      if (!ok) return;
      const res = await api(`/api/items/${id}`, { method: 'DELETE' });
      location.hash = '#/wardrobe';
      toast(res.removed_from ? `已删除，并从 ${res.removed_from} 套搭配中移除` : '已删除');
    });
  }

  /* ---------------- 搭配列表 ---------------- */

  function outfitMiniCard(outfit) {
    return `<a class="outfit-card" href="#/outfit/${outfit.id}">
      <div class="outfit-card-board">${boardMarkup(outfit, { mini: true })}</div>
      <div class="outfit-card-meta">
        <h3>${esc(outfit.name)}</h3>
        <p>${outfit.item_count ?? (outfit.items ? outfit.items.length : 0)} 件${outfit.occasion ? ' · ' + esc(outfit.occasion) : ''}</p>
      </div>
    </a>`;
  }

  function pageTabs(active) {
    return `<div class="page-tabs" role="tablist" aria-label="穿搭类型">
      <a class="mode-tab${active === 'own' ? ' is-active' : ''}" href="#/outfits" role="tab" aria-selected="${active === 'own'}">我的穿搭</a>
      <a class="mode-tab${active === 'reference' ? ' is-active' : ''}" href="#/reference" role="tab" aria-selected="${active === 'reference'}">参考穿搭</a>
    </div>`;
  }

  function referenceCard(outfit) {
    const cover = outfit.images && outfit.images[0];
    const count = outfit.images ? outfit.images.length : 0;
    return `<a class="ref-card" href="#/reference/${outfit.id}">
      <div class="ref-cover">
        ${cover ? `<img src="${esc(cover)}" alt="${esc(outfit.name)}" loading="lazy">` : `<span class="ref-empty">参考</span>`}
        ${count > 1 ? `<span class="ref-count">${count} 张</span>` : ''}
      </div>
      <div class="outfit-card-meta">
        <h3>${esc(outfit.name)}</h3>
        <p>${esc(outfit.occasion || '参考')}</p>
      </div>
    </a>`;
  }

  async function renderOutfitPages(kind) {
    view.innerHTML = `<p class="lede">载入中…</p>`;
    const data = await api('/api/outfits');
    const all = data.outfits || [];
    const own = all.filter((o) => o.kind !== 'reference');
    const refs = all.filter((o) => o.kind === 'reference');
    const isRef = kind === 'reference';

    view.innerHTML = `
      <header class="page-head">
        <div>
          <h1 class="page-title">搭配</h1>
          <p class="lede"><b>${own.length}</b> 套自己的穿搭 · <b>${refs.length}</b> 条参考</p>
        </div>
        <a class="btn btn-primary" href="${isRef ? '#/reference/new/edit' : '#/outfit/new/edit'}">${isRef ? '＋ 添加参考' : '＋ 新建搭配'}</a>
      </header>
      ${pageTabs(isRef ? 'reference' : 'own')}
      <div id="outfit-list"></div>`;

    const host = $('#outfit-list');
    if (isRef) {
      if (!refs.length) {
        host.innerHTML = `<div class="empty">
          <h2>还没有参考穿搭</h2>
          <p>把杂志、街拍或喜欢的博主穿搭收进来，当作自己的搭配灵感。</p>
          <a class="btn btn-primary" href="#/reference/new/edit">＋ 添加参考</a>
        </div>`;
        return;
      }
      host.innerHTML = `<div class="ref-grid">${refs.map(referenceCard).join('')}</div>`;
      return;
    }

    if (!own.length) {
      host.innerHTML = `<div class="empty">
        <h2>还没有自己的搭配</h2>
        <p>从衣橱里挑几件单品，拼成第一套穿搭。也可以先去<a class="inline-link" href="#/reference">参考穿搭</a>找找灵感。</p>
        <a class="btn btn-primary" href="#/outfit/new/edit">＋ 新建搭配</a>
      </div>`;
      return;
    }
    host.innerHTML = `<div class="outfit-grid">${own.map(outfitMiniCard).join('')}</div>`;
  }

  /* ---------------- 搭配详情（整体效果） ---------------- */

  async function renderOutfitDetail(id) {
    view.innerHTML = `<p class="lede">正在铺开搭配…</p>`;
    const outfit = await api(`/api/outfits/${id}`);
    if (outfit.kind === 'reference') {
      location.hash = `#/reference/${id}`;
      return;
    }
    let mode = localStorage.getItem('wardrobe.boardMode') === 'mannequin' ? 'mannequin' : 'flat';

    const groups = CATS.map((c) => ({ ...c, items: (outfit.items || []).filter((i) => i.category === c.key) }))
      .filter((g) => g.items.length);

    view.innerHTML = `
      <div class="detail-head">
        <a class="back-link" href="#/outfits">← 返回搭配</a>
        <div class="actions">
          <button class="btn btn-primary" type="button" id="export-board">导出图片</button>
          <button class="btn" type="button" id="copy-outfit">复制</button>
          <a class="btn" href="#/outfit/${outfit.id}/edit">编辑</a>
          <button class="btn btn-danger" type="button" id="delete-outfit">删除</button>
        </div>
      </div>
      <div class="outfit-layout">
        <div class="board-wrap">
          <div class="mode-tabs" role="tablist" aria-label="展示方式">
            <button class="mode-tab${mode === 'flat' ? ' is-active' : ''}" type="button" data-mode="flat">平铺</button>
            <button class="mode-tab${mode === 'mannequin' ? ' is-active' : ''}" type="button" data-mode="mannequin">人台</button>
          </div>
          <div class="board-shell" id="board-host">${boardMarkup(outfit, { mode, withTitle: true })}</div>
        </div>
        <aside class="outfit-side">
          <h1 class="outfit-title">${esc(outfit.name)}</h1>
          ${outfit.occasion ? `<span class="occasion">${esc(outfit.occasion)}</span>` : ''}
          ${outfit.notes ? `<p class="notes">${esc(outfit.notes)}</p>` : ''}
          <div class="side-heading"><h2>构成单品</h2><span>${outfit.item_count} 件</span></div>
          ${groups.length ? `<ul class="piece-list">
            ${groups.map((g) => g.items.map((item) => `
              <li><a class="piece" href="#/item/${item.id}">
                <span class="piece-thumb">${item.image ? `<img src="${esc(item.image)}" alt="">` : esc(g.label)}</span>
                <span class="piece-info"><strong>${esc(item.name)}</strong><small>${esc(g.label)}${item.color ? ' · ' + esc(item.color) : ''}</small></span>
              </a></li>`).join('')).join('')}
          </ul>` : `<p class="lede">这套搭配还没有单品。</p>`}
          <p class="updated">更新于 ${esc(fmtDate(outfit.updated_at))}</p>
        </aside>
      </div>`;

    const host = $('#board-host');
    $$('[data-mode]', view).forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        localStorage.setItem('wardrobe.boardMode', mode);
        host.innerHTML = boardMarkup(outfit, { mode, withTitle: true });
        $$('[data-mode]', view).forEach((b) => b.classList.toggle('is-active', b === btn));
      });
    });

    $('#export-board').addEventListener('click', async () => {
      const btn = $('#export-board');
      btn.disabled = true;
      try {
        await exportBoard(outfit, mode);
      } catch (err) {
        toast(err.message || '导出失败', true);
      } finally {
        btn.disabled = false;
      }
    });

    $('#copy-outfit').addEventListener('click', async () => {
      const copied = await api('/api/outfits', {
        method: 'POST',
        body: JSON.stringify({
          name: `${outfit.name} · 副本`,
          occasion: outfit.occasion,
          notes: outfit.notes,
          items: (outfit.items || []).map((i) => i.id),
        }),
      });
      toast('已复制一套搭配');
      location.hash = `#/outfit/${copied.id}`;
    });

    $('#delete-outfit').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '删除搭配',
        message: `确定删除「${outfit.name}」吗？单品本身不会被删除。`,
      });
      if (!ok) return;
      await api(`/api/outfits/${id}`, { method: 'DELETE' });
      location.hash = '#/outfits';
      toast('搭配已删除');
    });
  }

  /* ---------------- 参考穿搭 ---------------- */

  function openImageLightbox(src, title) {
    const modal = openModal({ title: title || '参考图', wide: true });
    modal.body.style.padding = '12px 20px 20px';
    modal.body.innerHTML = `<img class="lightbox-img" src="${esc(src)}" alt="${esc(title)}">`;
    modal.foot.innerHTML = '';
  }

  async function renderReferenceDetail(id) {
    view.innerHTML = `<p class="lede">载入中…</p>`;
    const outfit = await api(`/api/outfits/${id}`);
    if (outfit.kind !== 'reference') {
      location.hash = `#/outfit/${id}`;
      return;
    }
    const images = outfit.images || [];

    view.innerHTML = `
      <div class="detail-head">
        <a class="back-link" href="#/reference">← 返回参考穿搭</a>
        <div class="actions">
          <a class="btn" href="#/reference/${outfit.id}/edit">编辑</a>
          <button class="btn btn-danger" type="button" id="delete-ref">删除</button>
        </div>
      </div>
      <div class="outfit-layout">
        <div class="ref-gallery">
          ${images.map((src, i) => `
            <button type="button" class="ref-shot" data-src="${esc(src)}">
              <img src="${esc(src)}" alt="${esc(outfit.name)} 参考图 ${i + 1}" loading="lazy">
            </button>`).join('')}
        </div>
        <aside class="outfit-side">
          <h1 class="outfit-title">${esc(outfit.name)}</h1>
          ${outfit.occasion ? `<span class="occasion">${esc(outfit.occasion)}</span>` : ''}
          ${outfit.notes ? `<p class="notes">${esc(outfit.notes)}</p>` : ''}
          <div class="side-heading"><h2>参考图</h2><span>${images.length} 张</span></div>
          <p class="lede">点开照片可以放大看细节。</p>
          <p class="updated">收录于 ${esc(fmtDate(outfit.created_at))}</p>
        </aside>
      </div>`;

    $$('.ref-shot', view).forEach((btn) => {
      btn.addEventListener('click', () => openImageLightbox(btn.dataset.src, outfit.name));
    });

    $('#delete-ref').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '删除参考',
        message: `确定删除「${outfit.name}」吗？照片也会一起移除。`,
      });
      if (!ok) return;
      await api(`/api/outfits/${id}`, { method: 'DELETE' });
      location.hash = '#/reference';
      toast('参考已删除');
    });
  }

  async function renderReferenceEditor(id) {
    view.innerHTML = `<p class="lede">载入中…</p>`;
    const isEdit = id !== 'new' && id != null;
    const outfit = isEdit ? await api(`/api/outfits/${id}`) : null;
    if (outfit && outfit.kind !== 'reference') {
      location.hash = `#/outfit/${id}/edit`;
      return;
    }
    const images = outfit ? (outfit.images || []).slice() : [];
    const backHref = isEdit ? `#/reference/${id}` : '#/reference';

    view.innerHTML = `
      <div class="editor-head">
        <a class="back-link" href="${backHref}">← 返回</a>
        <h1>${isEdit ? '编辑参考穿搭' : '添加参考穿搭'}</h1>
      </div>
      <form id="ref-form" novalidate>
        <div class="form-card">
          <div class="field-row">
            <div class="field">
              <label for="r-name">标题</label>
              <input class="input" id="r-name" maxlength="80" placeholder="例如：驼色风衣街拍" value="${esc(outfit ? outfit.name : '')}">
            </div>
            <div class="field">
              <label for="r-occasion">场合</label>
              <input class="input" id="r-occasion" maxlength="40" placeholder="通勤 / 约会 / 出游" value="${esc(outfit ? outfit.occasion : '')}">
            </div>
          </div>
          <div class="field">
            <label for="r-notes">备注</label>
            <textarea class="textarea" id="r-notes" maxlength="1000" placeholder="记下喜欢的点：配色、层次、单品">${esc(outfit ? outfit.notes : '')}</textarea>
          </div>
          <div class="field">
            <span class="field-label">参考图</span>
            <div class="photo-manager" id="ref-manager"></div>
            <input type="file" id="ref-files" accept="image/*" multiple hidden>
          </div>
        </div>
        <div class="editor-foot">
          <span class="selected-count" id="ref-count"></span>
          <div class="editor-buttons">
            <a class="btn" href="${backHref}">取消</a>
            <button class="btn btn-primary" type="submit" id="save-ref">保存</button>
          </div>
        </div>
      </form>`;

    const manager = $('#ref-manager');
    const fileInput = $('#ref-files');

    const paint = () => {
      manager.innerHTML = images.map((src, i) => `
        <div class="photo-thumb">
          <img src="${esc(src)}" alt="参考图 ${i + 1}">
          <button type="button" class="photo-remove" data-remove="${i}" aria-label="移除这张照片">×</button>
        </div>`).join('')
        + `<button type="button" class="photo-add" id="add-photos"><span>＋</span><small>添加照片</small></button>`;
      $('#ref-count').textContent = images.length
        ? `已放 ${images.length} 张参考图`
        : '还没有照片';
      $('#add-photos').addEventListener('click', () => fileInput.click());
    };
    paint();

    manager.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      images.splice(Number(btn.dataset.remove), 1);
      paint();
    });

    const addFiles = async (files) => {
      for (const file of files) {
        if (images.length >= 8) {
          toast('最多放 8 张参考图', true);
          break;
        }
        try {
          images.push(await readImageFile(file));
          paint();
        } catch (err) {
          toast(err.message || '图片读取失败', true);
        }
      }
    };

    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      addFiles(files);
    });

    manager.addEventListener('dragover', (e) => e.preventDefault());
    manager.addEventListener('drop', (e) => {
      e.preventDefault();
      addFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
    });

    $('#ref-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#r-name').value.trim();
      if (!name) {
        toast('给这条参考起个标题', true);
        $('#r-name').focus();
        return;
      }
      if (!images.length) {
        toast('至少放一张参考图', true);
        return;
      }
      const payload = {
        kind: 'reference',
        name,
        occasion: $('#r-occasion').value.trim(),
        notes: $('#r-notes').value.trim(),
        images,
      };
      const btn = $('#save-ref');
      btn.disabled = true;
      btn.textContent = '保存中…';
      try {
        const saved = await api(isEdit ? `/api/outfits/${id}` : '/api/outfits', {
          method: isEdit ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        });
        toast(isEdit ? '参考已更新' : '参考已收藏');
        location.hash = `#/reference/${saved.id}`;
      } catch (err) {
        toast(err.message || '保存失败', true);
        btn.disabled = false;
        btn.textContent = '保存';
      }
    });
  }

  /* ---------------- 搭配编辑 ---------------- */

  async function renderOutfitEditor(id) {
    view.innerHTML = `<p class="lede">载入中…</p>`;
    const isEdit = id !== 'new' && id != null;
    const [outfit, itemsData] = await Promise.all([
      isEdit ? api(`/api/outfits/${id}`) : Promise.resolve(null),
      api('/api/items'),
    ]);
    if (outfit && outfit.kind === 'reference') {
      location.hash = `#/reference/${id}/edit`;
      return;
    }
    const allItems = itemsData.items || [];
    const selected = outfit ? (outfit.items || []).map((i) => i.id) : [];

    const pickGroup = (cat) => {
      const items = allItems.filter((i) => i.category === cat.key);
      if (!items.length) {
        return `<div class="picker-section">
          <div class="picker-head"><h3>${cat.label}</h3><span>0 件</span></div>
          <p class="lede">衣橱里还没有${cat.label}。</p>
        </div>`;
      }
      return `<div class="picker-section">
        <div class="picker-head"><h3>${cat.label}</h3><span>${items.length} 件</span></div>
        <div class="pick-grid">
          ${items.map((item) => `
            <button class="pick-tile${selected.includes(item.id) ? ' is-on' : ''}" type="button" data-id="${item.id}" aria-pressed="${selected.includes(item.id)}">
              <span class="pick-photo">${item.image ? `<img src="${esc(item.image)}" alt="">` : esc(cat.label)}</span>
              <span class="pick-name">${esc(item.name)}</span>
              <span class="pick-check">✓</span>
            </button>`).join('')}
        </div>
      </div>`;
    };

    view.innerHTML = `
      <div class="editor-head">
        <a class="back-link" href="${isEdit ? `#/outfit/${id}` : '#/outfits'}">← 返回</a>
        <h1>${isEdit ? '编辑搭配' : '新建搭配'}</h1>
      </div>
      ${allItems.length ? '' : `<div class="empty" style="margin-bottom:26px">
        <h2>衣橱里还没有单品</h2>
        <p>先添加几件衣服，再回来组合搭配。</p>
        <a class="btn btn-primary" href="#/wardrobe">去衣橱添加</a>
      </div>`}
      <form id="outfit-form" novalidate>
        <div class="form-card">
          <div class="field-row">
            <div class="field">
              <label for="o-name">搭配名称</label>
              <input class="input" id="o-name" maxlength="80" placeholder="例如：周末咖啡馆" value="${esc(outfit ? outfit.name : '')}">
            </div>
            <div class="field">
              <label for="o-occasion">场合</label>
              <input class="input" id="o-occasion" maxlength="40" placeholder="通勤 / 约会 / 出游" value="${esc(outfit ? outfit.occasion : '')}">
            </div>
          </div>
          <div class="field">
            <label for="o-notes">备注</label>
            <textarea class="textarea" id="o-notes" maxlength="1000" placeholder="天气、心情，或为什么这样搭">${esc(outfit ? outfit.notes : '')}</textarea>
          </div>
        </div>

        <div class="side-heading"><h2>挑选单品</h2><span>可多件自由组合</span></div>
        <div id="picker">${CATS.map(pickGroup).join('')}</div>

        <div class="editor-foot">
          <span class="selected-count" id="selected-count">已选 <b>0</b> 件</span>
          <div class="editor-buttons">
            <a class="btn" href="${isEdit ? `#/outfit/${id}` : '#/outfits'}">取消</a>
            <button class="btn btn-primary" type="submit" id="save-outfit">保存搭配</button>
          </div>
        </div>
      </form>`;

    const countEl = $('#selected-count b');
    const paintCount = () => { countEl.textContent = String(selected.length); };
    paintCount();

    $('#picker').addEventListener('click', (e) => {
      const tile = e.target.closest('.pick-tile');
      if (!tile) return;
      const itemId = Number(tile.dataset.id);
      const index = selected.indexOf(itemId);
      if (index >= 0) selected.splice(index, 1);
      else selected.push(itemId);
      tile.classList.toggle('is-on', index < 0);
      tile.setAttribute('aria-pressed', String(index < 0));
      paintCount();
    });

    $('#outfit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#o-name').value.trim();
      if (!name) {
        toast('给这套搭配起个名字', true);
        $('#o-name').focus();
        return;
      }
      const payload = {
        name,
        occasion: $('#o-occasion').value.trim(),
        notes: $('#o-notes').value.trim(),
        items: selected,
      };
      const btn = $('#save-outfit');
      btn.disabled = true;
      btn.textContent = '保存中…';
      try {
        const saved = await api(isEdit ? `/api/outfits/${id}` : '/api/outfits', {
          method: isEdit ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        });
        toast(isEdit ? '搭配已更新' : '搭配已保存');
        location.hash = `#/outfit/${saved.id}`;
      } catch (err) {
        toast(err.message || '保存失败', true);
        btn.disabled = false;
        btn.textContent = '保存搭配';
      }
    });
  }

  /* ---------------- 单品表单 ---------------- */

  function openItemForm(item) {
    const isEdit = !!item;
    const modal = openModal({ title: isEdit ? '编辑单品' : '添加单品', wide: true });
    let imageSrc = item && item.image ? item.image : '';
    let imageData = null;
    let removedImage = false;
    let category = item ? item.category : 'top';
    let sleeve = item && item.sleeve ? item.sleeve : '';
    const seasons = new Set(item ? splitList(item.seasons) : []);

    const catButtons = CATS.map((c) => (
      `<button class="seg-opt${category === c.key ? ' is-on' : ''}" type="button" data-cat="${c.key}">${c.label}</button>`
    )).join('');
    const seasonButtons = SEASONS.map((s) => (
      `<button class="seg-opt${seasons.has(s) ? ' is-on' : ''}" type="button" data-season="${s}">${s}</button>`
    )).join('');
    const sleeveButtons = SLEEVES.map((s) => (
      `<button class="seg-opt${sleeve === s.key ? ' is-on' : ''}" type="button" data-sleeve="${s.key}">${s.label}</button>`
    )).join('');

    modal.body.innerHTML = `
      <form id="item-form" novalidate>
        <div class="field">
          <span class="field-label">照片</span>
          <div class="drop" id="f-drop" role="button" tabindex="0">
            <input type="file" accept="image/*" id="f-file" hidden>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="f-name">名称</label>
            <input class="input" id="f-name" maxlength="80" placeholder="例如：米白针织衫" value="${esc(item ? item.name : '')}">
          </div>
          <div class="field">
            <label for="f-color">颜色</label>
            <input class="input" id="f-color" maxlength="40" placeholder="米白、藏蓝…" value="${esc(item ? item.color : '')}">
          </div>
        </div>
        <div class="field">
          <span class="field-label">类别</span>
          <div class="seg" id="f-cat">${catButtons}</div>
        </div>
        <div class="field">
          <span class="field-label">适合季节</span>
          <div class="seg" id="f-seasons">${seasonButtons}</div>
        </div>
        <div class="field" id="sleeve-field">
          <span class="field-label">长短袖</span>
          <div class="seg" id="f-sleeve">${sleeveButtons}</div>
        </div>
        <div class="field">
          <label for="f-tags">标签</label>
          <input class="input" id="f-tags" maxlength="120" placeholder="通勤、休闲、约会（用逗号分隔）" value="${esc(item ? item.tags : '')}">
        </div>
        <div class="field">
          <label for="f-notes">备注</label>
          <textarea class="textarea" id="f-notes" maxlength="1000" placeholder="版型、材质，或和什么搭最好看">${esc(item ? item.notes : '')}</textarea>
        </div>
      </form>`;

    modal.foot.innerHTML = `
      <button class="btn" type="button" data-cancel>取消</button>
      <button class="btn btn-primary" type="submit" form="item-form" id="save-item">保存</button>`;

    const drop = $('#f-drop', modal.body);
    const fileInput = $('#f-file', modal.body);

    const paintDrop = () => {
      if (imageSrc) {
        drop.innerHTML = `<div class="drop-preview">
          <img src="${esc(imageSrc)}" alt="照片预览">
          <div class="drop-actions">
            <span>${imageData ? '新照片已选好' : '当前照片'}</span>
            <span>点击这里可以换一张</span>
            <button class="link-btn" type="button" data-remove>移除照片</button>
          </div>
        </div>`;
        if (!drop.contains(fileInput)) drop.appendChild(fileInput);
      } else {
        drop.innerHTML = `<div class="drop-inner">
          <span>点击选择照片，或把图片拖到这里</span>
          <small>会自动压缩，照片只保存在这台电脑上</small>
        </div>`;
        drop.appendChild(fileInput);
      }
    };
    paintDrop();

    const sleeveField = $('#sleeve-field', modal.body);
    const syncSleeveField = () => {
      sleeveField.hidden = !(category === 'top' || category === 'outerwear');
    };
    syncSleeveField();

    const takeFile = async (file) => {
      try {
        imageData = await readImageFile(file);
        imageSrc = imageData;
        removedImage = false;
        paintDrop();
      } catch (err) {
        toast(err.message || '图片读取失败', true);
      }
    };

    drop.addEventListener('click', (e) => {
      if (e.target.closest('[data-remove]')) {
        e.preventDefault();
        imageSrc = '';
        imageData = null;
        removedImage = isEdit;
        paintDrop();
        return;
      }
      fileInput.click();
    });

    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) takeFile(fileInput.files[0]);
      fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach((type) => {
      drop.addEventListener(type, (e) => {
        e.preventDefault();
        drop.classList.add('is-drag');
      });
    });
    ['dragleave', 'drop'].forEach((type) => {
      drop.addEventListener(type, (e) => {
        e.preventDefault();
        drop.classList.remove('is-drag');
      });
    });
    drop.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) takeFile(file);
    });

    $('#f-cat', modal.body).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      category = btn.dataset.cat;
      $$('#f-cat .seg-opt', modal.body).forEach((b) => b.classList.toggle('is-on', b === btn));
      syncSleeveField();
    });

    $('#f-seasons', modal.body).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-season]');
      if (!btn) return;
      const value = btn.dataset.season;
      if (seasons.has(value)) seasons.delete(value);
      else seasons.add(value);
      btn.classList.toggle('is-on', seasons.has(value));
    });

    $('#f-sleeve', modal.body).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sleeve]');
      if (!btn) return;
      sleeve = sleeve === btn.dataset.sleeve ? '' : btn.dataset.sleeve;
      $$('#f-sleeve .seg-opt', modal.body).forEach((b) => {
        b.classList.toggle('is-on', b.dataset.sleeve === sleeve);
      });
    });

    modal.foot.querySelector('[data-cancel]').addEventListener('click', modal.close);

    $('#item-form', modal.body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#f-name').value.trim();
      if (!name) {
        toast('给这件单品起个名字', true);
        $('#f-name').focus();
        return;
      }
      const payload = {
        name,
        category,
        color: $('#f-color').value.trim(),
        seasons: Array.from(seasons).join(','),
        sleeve: category === 'top' || category === 'outerwear' ? sleeve : '',
        tags: $('#f-tags').value.trim(),
        notes: $('#f-notes').value.trim(),
      };
      if (imageData) payload.image_data = imageData;
      else if (removedImage) payload.remove_image = true;

      const btn = $('#save-item');
      btn.disabled = true;
      btn.textContent = '保存中…';
      try {
        await api(isEdit ? `/api/items/${item.id}` : '/api/items', {
          method: isEdit ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        });
        modal.close();
        toast(isEdit ? '单品已更新' : '单品已放进衣橱');
        route();
      } catch (err) {
        toast(err.message || '保存失败', true);
        btn.disabled = false;
        btn.textContent = '保存';
      }
    });
  }

  /* ---------------- 备份 ---------------- */

  async function downloadBackup() {
    const data = await api('/api/backup');
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `衣橱备份-${fmtDate(new Date().toISOString())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 3000);
    toast('备份已导出');
  }

  async function restoreBackup(file) {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      toast('这个文件不是有效的备份', true);
      return;
    }
    const ok = await confirmDialog({
      title: '导入备份',
      message: `导入会覆盖当前衣橱里的所有单品和搭配。\n确定用「${file.name}」恢复吗？`,
      confirmLabel: '覆盖导入',
    });
    if (!ok) return;
    const res = await api('/api/restore', { method: 'POST', body: JSON.stringify(data) });
    toast(`已导入 ${res.items} 件单品、${res.outfits} 套搭配`);
    location.hash = '#/wardrobe';
    route();
  }

  /* ---------------- 路由 ---------------- */

  function setActiveNav(section) {
    $$('.nav-link').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === section));
  }

  async function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean);
    const seg = parts[0] || 'wardrobe';

    try {
      if (seg === 'wardrobe' || seg === '') {
        setActiveNav('wardrobe');
        await renderWardrobe();
      } else if (seg === 'item' && parts[1]) {
        setActiveNav('wardrobe');
        await renderItemDetail(parts[1]);
      } else if (seg === 'outfits') {
        setActiveNav('outfits');
        await renderOutfitPages('own');
      } else if (seg === 'reference' && parts[1] && parts[2] === 'edit') {
        setActiveNav('outfits');
        await renderReferenceEditor(parts[1]);
      } else if (seg === 'reference' && parts[1]) {
        setActiveNav('outfits');
        await renderReferenceDetail(parts[1]);
      } else if (seg === 'reference') {
        setActiveNav('outfits');
        await renderOutfitPages('reference');
      } else if (seg === 'outfit' && parts[1] && parts[2] === 'edit') {
        setActiveNav('outfits');
        await renderOutfitEditor(parts[1]);
      } else if (seg === 'outfit' && parts[1]) {
        setActiveNav('outfits');
        await renderOutfitDetail(parts[1]);
      } else {
        location.hash = '#/wardrobe';
        return;
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (err) {
      view.innerHTML = `<div class="empty">
        <h2>出了点问题</h2>
        <p>${esc(err.message || '未知错误')}</p>
        <a class="btn btn-primary" href="#/wardrobe">回到衣橱</a>
      </div>`;
    }
  }

  /* ---------------- 启动 ---------------- */

  $('#btn-backup').addEventListener('click', () => {
    downloadBackup().catch((err) => toast(err.message || '导出失败', true));
  });

  $('#btn-restore').addEventListener('click', () => $('#restore-file').click());

  $('#restore-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) restoreBackup(file).catch((err) => toast(err.message || '导入失败', true));
    e.target.value = '';
  });

  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/wardrobe';
  route();
})();
