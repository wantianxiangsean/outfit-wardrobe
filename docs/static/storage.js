/* 浏览器本地存储模式：在 GitHub Pages 等纯静态环境替代 Python 后端。
   数据全部保存在当前浏览器的 IndexedDB 中，不会上传到任何服务器。 */
(() => {
  'use strict';

  const DB_NAME = 'wardrobe-static';
  const DB_VERSION = 1;
  const CATEGORIES = ['outerwear', 'top', 'bottom', 'shoes', 'accessory'];
  const SLEEVES = ['short', 'long'];
  const CATEGORY_SET = new Set(CATEGORIES);
  const SLEEVE_SET = new Set(SLEEVES);
  const CATEGORY_ORDER = { outerwear: 0, top: 1, bottom: 2, shoes: 3, accessory: 4 };

  let dbPromise = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains('items')) {
          database.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
        }
        if (!database.objectStoreNames.contains('outfits')) {
          database.createObjectStore('outfits', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const db = () => (dbPromise || (dbPromise = openDB()));

  function reqDone(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll(store) {
    const database = await db();
    return reqDone(database.transaction(store, 'readonly').objectStore(store).getAll());
  }

  async function getOne(store, id) {
    const database = await db();
    return reqDone(database.transaction(store, 'readonly').objectStore(store).get(id));
  }

  let queue = Promise.resolve();
  function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  async function write(ops) {
    const database = await db();
    const stores = [...new Set(ops.map((op) => op.store))];
    return new Promise((resolve, reject) => {
      const tx = database.transaction(stores, 'readwrite');
      let last = null;
      ops.forEach((op) => {
        const store = tx.objectStore(op.store);
        if (op.type === 'put') last = store.put(op.value);
        else if (op.type === 'delete') last = store.delete(op.id);
        else if (op.type === 'clear') last = store.clear();
      });
      tx.oncomplete = () => resolve(last ? last.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('写入失败'));
    });
  }

  const now = () => new Date().toISOString().slice(0, 19);
  const clean = (value, limit) => String(value ?? '').trim().slice(0, limit);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const isImage = (value) => typeof value === 'string' && value.startsWith('data:image/');

  function itemView(raw) {
    return clone(raw);
  }

  function outfitView(raw, items) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const picked = (raw.itemIds || []).map((id) => byId.get(id)).filter(Boolean);
    const cover = {};
    picked.forEach((item) => {
      if (!cover[item.category] && item.image) cover[item.category] = item.image;
    });
    return {
      id: raw.id,
      name: raw.name,
      occasion: raw.occasion,
      notes: raw.notes,
      kind: raw.kind,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
      items: clone(picked),
      item_count: picked.length,
      cover,
      images: clone(raw.images || []),
    };
  }

  function itemFields(body) {
    const name = clean(body.name, 80);
    const category = String(body.category || '').trim();
    if (!name) throw new Error('请填写单品名称');
    if (!CATEGORY_SET.has(category)) throw new Error('请选择正确的类别');
    const sleeve = SLEEVE_SET.has(body.sleeve) ? body.sleeve : '';
    return {
      name,
      category,
      color: clean(body.color, 40),
      seasons: clean(body.seasons, 60),
      sleeve,
      tags: clean(body.tags, 120),
      notes: clean(body.notes, 1000),
    };
  }

  function outfitFields(body) {
    const name = clean(body.name, 80);
    if (!name) throw new Error('请填写搭配名称');
    const kind = body.kind === 'reference' ? 'reference' : 'own';
    const itemIds = [
      ...new Set((Array.isArray(body.items) ? body.items : []).map(Number).filter(Number.isInteger)),
    ];
    const images = (Array.isArray(body.images) ? body.images : []).filter(isImage);
    return { name, occasion: clean(body.occasion, 40), notes: clean(body.notes, 1000), kind, itemIds, images };
  }

  function sortItems(a, b) {
    return (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9) || b.id - a.id;
  }

  function sortOutfits(a, b) {
    const byTime = String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    return byTime || b.id - a.id;
  }

  async function listItems(query) {
    const all = await getAll('items');
    let items = all.slice();
    const category = query.get('category') || '';
    const keyword = (query.get('q') || '').trim().toLowerCase();
    const season = query.get('season') || '';
    const sleeve = query.get('sleeve') || '';
    if (CATEGORY_SET.has(category)) items = items.filter((item) => item.category === category);
    if (SLEEVE_SET.has(sleeve)) items = items.filter((item) => item.sleeve === sleeve);
    if (season) items = items.filter((item) => String(item.seasons || '').includes(season));
    if (keyword) {
      items = items.filter((item) =>
        [item.name, item.color, item.tags, item.notes].join(' ').toLowerCase().includes(keyword)
      );
    }
    const counts = Object.fromEntries(CATEGORIES.map((key) => [key, 0]));
    all.forEach((item) => {
      counts[item.category] = (counts[item.category] || 0) + 1;
    });
    items.sort(sortItems);
    return { items: items.map(itemView), counts, total: items.length };
  }

  async function listOutfits(query) {
    const items = await getAll('items');
    let outfits = await getAll('outfits');
    const kind = query.get('kind') || '';
    if (kind === 'own' || kind === 'reference') {
      outfits = outfits.filter((outfit) => outfit.kind === kind);
    }
    outfits.sort(sortOutfits);
    return { outfits: outfits.map((outfit) => outfitView(outfit, items)) };
  }

  async function handle(context, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    let body = {};
    if (options.body) {
      try {
        body = JSON.parse(options.body);
      } catch {
        throw new Error('请求内容不是有效的 JSON');
      }
    }
    const url = new URL(context, location.href);
    const parts = url.pathname.split('/').filter(Boolean);
    const query = url.searchParams;
    const resource = parts[1] || '';
    let id = null;
    if (parts[2] != null && parts[2] !== '') {
      id = Number(parts[2]);
      if (!Number.isInteger(id)) throw new Error('无效的编号');
    }

    if (resource === 'items') {
      if (method === 'GET' && id == null) return listItems(query);
      if (method === 'GET') {
        const item = await getOne('items', id);
        if (!item) throw new Error('单品不存在');
        const outfits = (await getAll('outfits'))
          .filter((outfit) => outfit.kind !== 'reference' && (outfit.itemIds || []).includes(id))
          .sort(sortOutfits)
          .map((outfit) => ({ id: outfit.id, name: outfit.name, occasion: outfit.occasion }));
        return { ...itemView(item), outfits };
      }
      if (method === 'POST') {
        const fields = itemFields(body);
        const stamp = now();
        const record = {
          ...fields,
          image: isImage(body.image_data) ? body.image_data : '',
          created_at: stamp,
          updated_at: stamp,
        };
        const newId = await serial(() => write([{ store: 'items', type: 'put', value: record }]));
        return itemView({ ...record, id: newId });
      }
      if (method === 'PUT') {
        const existing = await getOne('items', id);
        if (!existing) throw new Error('单品不存在');
        const fields = itemFields(body);
        let image = existing.image || '';
        if (isImage(body.image_data)) image = body.image_data;
        else if (body.remove_image) image = '';
        const updated = { ...existing, ...fields, image, updated_at: now() };
        await serial(() => write([{ store: 'items', type: 'put', value: updated }]));
        return itemView(updated);
      }
      if (method === 'DELETE') {
        const existing = await getOne('items', id);
        if (!existing) throw new Error('单品不存在');
        const outfits = await getAll('outfits');
        const affected = outfits.filter((outfit) => (outfit.itemIds || []).includes(id));
        const ops = [{ store: 'items', type: 'delete', id }];
        affected.forEach((outfit) => {
          ops.push({
            store: 'outfits',
            type: 'put',
            value: {
              ...outfit,
              itemIds: outfit.itemIds.filter((itemId) => itemId !== id),
              updated_at: now(),
            },
          });
        });
        await serial(() => write(ops));
        return { ok: true, removed_from: affected.length };
      }
    }

    if (resource === 'outfits') {
      if (method === 'GET' && id == null) return listOutfits(query);
      const items = await getAll('items');
      if (method === 'GET') {
        const outfit = await getOne('outfits', id);
        if (!outfit) throw new Error('搭配不存在');
        return outfitView(outfit, items);
      }
      if (method === 'POST') {
        const fields = outfitFields(body);
        if (fields.kind === 'reference' && !fields.images.length) {
          throw new Error('参考穿搭至少要放一张照片');
        }
        const validIds = fields.itemIds.filter((itemId) => items.some((item) => item.id === itemId));
        const stamp = now();
        const record = {
          name: fields.name,
          occasion: fields.occasion,
          notes: fields.notes,
          kind: fields.kind,
          itemIds: fields.kind === 'own' ? validIds : [],
          images: fields.kind === 'reference' ? fields.images : [],
          created_at: stamp,
          updated_at: stamp,
        };
        const newId = await serial(() => write([{ store: 'outfits', type: 'put', value: record }]));
        return outfitView({ ...record, id: newId }, items);
      }
      if (method === 'PUT') {
        const existing = await getOne('outfits', id);
        if (!existing) throw new Error('搭配不存在');
        const fields = outfitFields(body);
        const kind = existing.kind;
        if (kind === 'reference' && !fields.images.length) {
          throw new Error('参考穿搭至少要放一张照片');
        }
        const validIds = fields.itemIds.filter((itemId) => items.some((item) => item.id === itemId));
        const updated = {
          ...existing,
          name: fields.name,
          occasion: fields.occasion,
          notes: fields.notes,
          itemIds: kind === 'own' ? validIds : existing.itemIds || [],
          images: kind === 'reference' ? fields.images : existing.images || [],
          updated_at: now(),
        };
        await serial(() => write([{ store: 'outfits', type: 'put', value: updated }]));
        return outfitView(updated, items);
      }
      if (method === 'DELETE') {
        const existing = await getOne('outfits', id);
        if (!existing) throw new Error('搭配不存在');
        await serial(() => write([{ store: 'outfits', type: 'delete', id }]));
        return { ok: true };
      }
    }

    if (resource === 'stats' && method === 'GET' && id == null) {
      const items = await getAll('items');
      const outfits = await getAll('outfits');
      const counts = Object.fromEntries(CATEGORIES.map((key) => [key, 0]));
      items.forEach((item) => {
        counts[item.category] = (counts[item.category] || 0) + 1;
      });
      return {
        items: items.length,
        outfits: outfits.length,
        own_outfits: outfits.filter((outfit) => outfit.kind !== 'reference').length,
        reference_outfits: outfits.filter((outfit) => outfit.kind === 'reference').length,
        counts,
      };
    }

    if (resource === 'backup' && method === 'GET' && id == null) {
      const items = await getAll('items');
      const outfits = await getAll('outfits');
      return {
        app: 'outfit-wardrobe',
        version: 1,
        exported_at: now(),
        items: items.map((item) => {
          const { image, ...rest } = item;
          return { ...rest, image_data: image || '' };
        }),
        outfits: outfits.map((outfit) => ({
          name: outfit.name,
          occasion: outfit.occasion,
          notes: outfit.notes,
          kind: outfit.kind,
          created_at: outfit.created_at,
          items: outfit.itemIds || [],
          images: outfit.images || [],
        })),
      };
    }

    if (resource === 'restore' && method === 'POST' && id == null) {
      if (body.app !== 'outfit-wardrobe' || !Array.isArray(body.items)) {
        throw new Error('这不是本系统导出的备份文件');
      }
      const idMap = new Map();
      const itemRecords = [];
      body.items.forEach((raw) => {
        const name = clean(raw.name, 80);
        if (!name || !CATEGORY_SET.has(raw.category)) return;
        const newId = itemRecords.length + 1;
        if (raw.id != null) idMap.set(raw.id, newId);
        itemRecords.push({
          id: newId,
          name,
          category: raw.category,
          color: clean(raw.color, 40),
          seasons: clean(raw.seasons, 60),
          sleeve: SLEEVE_SET.has(raw.sleeve) ? raw.sleeve : '',
          tags: clean(raw.tags, 120),
          image: isImage(raw.image_data) ? raw.image_data : '',
          notes: clean(raw.notes, 1000),
          created_at: raw.created_at || now(),
          updated_at: now(),
        });
      });
      const outfitRecords = [];
      (body.outfits || []).forEach((raw) => {
        const name = clean(raw.name, 80);
        if (!name) return;
        const kind = raw.kind === 'reference' ? 'reference' : 'own';
        const itemIds = (Array.isArray(raw.items) ? raw.items : [])
          .map((oldId) => idMap.get(oldId))
          .filter((value) => value != null);
        outfitRecords.push({
          id: outfitRecords.length + 1,
          name,
          occasion: clean(raw.occasion, 40),
          notes: clean(raw.notes, 1000),
          kind,
          itemIds: kind === 'own' ? itemIds : [],
          images: kind === 'reference' ? (raw.images || []).filter(isImage) : [],
          created_at: raw.created_at || now(),
          updated_at: now(),
        });
      });
      await serial(() =>
        write([
          { store: 'items', type: 'clear' },
          { store: 'outfits', type: 'clear' },
          ...itemRecords.map((value) => ({ store: 'items', type: 'put', value })),
          ...outfitRecords.map((value) => ({ store: 'outfits', type: 'put', value })),
        ])
      );
      return { ok: true, items: itemRecords.length, outfits: outfitRecords.length };
    }

    throw new Error('接口不存在');
  }

  window.StaticWardrobe = { handle };
})();
