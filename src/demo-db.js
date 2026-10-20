import seed from './seed.json' with { type: 'json' };

// GitHub Pages has no server database. This IndexedDB store belongs to one browser.
const DATABASE = 'private-cellar-pages-demo-v1';
const STORE = 'cellar';
const uid = () => crypto.randomUUID();
const fail = (message) => { throw new Error(message); };
const check = (condition, message) => { if (!condition) fail(message); };
const clean = (value) => typeof value === 'string' ? value.trim() : '';

function initialState() {
  const state = structuredClone(seed);
  const latest = Math.max(...state.movements.map(row => Date.parse(row.occurred_at)));
  const offset = Date.now() - latest - 86400000;
  for (const rows of [state.bottles, state.movements]) {
    for (const row of rows) {
      for (const key of ['acquired_at', 'created_at', 'occurred_at']) {
        if (row[key]) row[key] = new Date(Date.parse(row[key]) + offset).toISOString();
      }
    }
  }
  return state;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开浏览器本地数据库，请允许此网站保存数据。'));
    request.onblocked = () => reject(new Error('请先关闭此演示站点的其他旧标签页。'));
  });
}

export async function transact(change) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let result;
    let failure;
    const read = store.get('state');
    read.onsuccess = () => {
      try {
        const state = read.result || initialState();
        result = change(state);
        store.put(state, 'state');
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(failure || new Error('本地保存失败，请检查浏览器存储权限。')); };
  });
}

function view(state) {
  const wines = state.wines.map(wine => ({
    ...wine,
    stock: state.bottles.filter(b => b.wine_id === wine.id && b.status === 'in').length,
    owned_stock: state.bottles.filter(b => b.wine_id === wine.id && b.status === 'in' && b.ownership === 'self').length,
  })).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
  const parties = state.parties.map(party => ({
    ...party,
    consigned_count: state.bottles.filter(b => b.owner_party_id === party.id && b.ownership === 'consigned' && b.status === 'in').length,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const bottles = [...state.bottles].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const movements = [...state.movements].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id));
  return { wines, parties, bottles, movements };
}

function addMovement(state, bottle, action, destination, party, amount, now, tx, note) {
  const wine = state.wines.find(w => w.id === bottle.wine_id);
  state.movements.push({
    id: uid(), tx_id: tx, bottle_id: bottle.id, wine_id: bottle.wine_id,
    serial: bottle.serial, wine_name: wine.name, vintage: wine.vintage,
    action, destination, party_id: party?.id || null, party_name: party?.name || null,
    amount, location: bottle.location, occurred_at: now, note: note || null,
  });
}

function applyAction(state, body) {
  const type = clean(body.type);
  const now = new Date().toISOString();
  const tx = uid();
  if (type === 'pin') {
    const wine = state.wines.find(w => w.id === clean(body.wineId));
    check(wine, '酒款不存在');
    wine.pinned = wine.pinned ? 0 : 1;
    return { ok: true };
  }
  if (type === 'wine') {
    const name = clean(body.name), category = clean(body.category), origin = clean(body.origin), region = clean(body.region);
    const size = clean(body.size) || '750ml', estimate = Number(body.estimate), vintage = body.vintage ? Number(body.vintage) : null;
    check(name && category && origin && region && Number.isFinite(estimate) && estimate >= 0 &&
      (vintage === null || Number.isInteger(vintage) && vintage >= 1900 && vintage <= 2100), '请填写完整且有效的酒款档案');
    state.wines.push({ id: uid(), name, vintage, category, origin, region, size, estimate: Math.round(estimate), pinned: 0, stock: 0, owned_stock: 0 });
    return { ok: true };
  }
  if (type === 'party') {
    const name = clean(body.name), partyType = clean(body.partyType);
    check(name && ['客户', '朋友', '供应商'].includes(partyType), '请填写对象名称和类型');
    state.parties.push({ id: uid(), name, type: partyType, phone: clean(body.phone) || null, note: clean(body.note) || null, consigned_count: 0 });
    return { ok: true };
  }
  if (type === 'in') {
    const wine = state.wines.find(w => w.id === clean(body.wineId));
    const location = clean(body.location), ownership = clean(body.ownership) || 'self';
    const quantity = Number(body.quantity), cost = Number(body.unitCost || 0);
    const party = state.parties.find(p => p.id === clean(body.partyId));
    check(wine && location && Number.isInteger(quantity) && quantity >= 1 && quantity <= 48 &&
      Number.isFinite(cost) && cost >= 0 && ['self', 'consigned'].includes(ownership), '请检查酒款、数量、位置和金额');
    check(ownership !== 'consigned' || party?.type === '朋友', '寄存人必须是朋友');
    const selected = Array.isArray(body.selected) ? body.selected.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= quantity) : Array.from({ length: quantity }, (_, i) => i + 1);
    const unique = [...new Set(selected)];
    check(unique.length, '请至少勾选一瓶');
    for (const _slot of unique) {
      const id = `B-${Date.now().toString(36)}-${uid().slice(0, 8)}`.toUpperCase();
      const bottle = {
        id, wine_id: wine.id, wine_name: wine.name, vintage: wine.vintage, category: wine.category,
        serial: id, status: 'in', ownership, owner_party_id: ownership === 'consigned' ? party.id : null,
        owner_name: ownership === 'consigned' ? party.name : null, location,
        acquisition_cost: ownership === 'self' ? Math.round(cost) : 0,
        acquired_at: now, created_at: now, estimate: wine.estimate,
      };
      state.bottles.push(bottle);
      addMovement(state, bottle, ownership === 'consigned' ? 'deposit' : 'buy', null,
        ownership === 'consigned' ? party : null, bottle.acquisition_cost, now, tx, clean(body.note));
    }
    return { ok: true, count: unique.length, tx };
  }
  if (type === 'out' || type === 'pickup') {
    const destination = type === 'pickup' ? 'pickup' : clean(body.destination);
    const quantity = type === 'pickup' ? 1 : Number(body.quantity);
    check(['sale', 'gift', 'drink', 'pickup'].includes(destination) && Number.isInteger(quantity) && quantity >= 1 && quantity <= 48,
      '请选择有效的出库去向和数量');
    const party = state.parties.find(p => p.id === (type === 'pickup' ? clean(body.ownerPartyId) : clean(body.partyId)));
    check(destination !== 'sale' || party?.type === '客户', '请选择客户');
    check(!['gift', 'pickup'].includes(destination) || party?.type === '朋友', '请选择朋友');
    const unitAmount = Number(body.unitAmount || 0);
    check(Number.isFinite(unitAmount) && unitAmount >= 0 && (destination !== 'sale' || unitAmount > 0), '销售出库请填写大于 0 的单瓶售价');
    const rows = type === 'pickup'
      ? state.bottles.filter(b => b.id === clean(body.bottleId) && b.owner_party_id === party.id && b.ownership === 'consigned' && b.status === 'in')
      : state.bottles.filter(b => b.wine_id === clean(body.wineId) && b.status === 'in' && b.ownership === 'self')
        .sort((a, b) => a.acquired_at.localeCompare(b.acquired_at) || a.id.localeCompare(b.id)).slice(0, quantity);
    check(rows.length >= quantity, '可用库存不足，请刷新后重试');
    for (const bottle of rows) {
      check(!state.movements.some(m => m.bottle_id === bottle.id && m.action === 'out'), '这瓶酒已经出库');
      bottle.status = 'out';
      addMovement(state, bottle, 'out', destination, party, destination === 'sale' ? Math.round(unitAmount) : 0, now, tx, clean(body.note));
    }
    return { ok: true, count: quantity, tx };
  }
  fail('未知操作');
}

export async function demoRequest(url, options = {}) {
  try {
    if (url === '/api/state') return Response.json(await transact(view));
    if (url === '/api/actions') {
      const body = JSON.parse(options.body || '{}');
      return Response.json(await transact(state => applyAction(state, body)));
    }
    if (url === '/api/reset') return Response.json(await transact(state => Object.assign(state, initialState())));
    return Response.json({ error: '未知接口' }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error?.message || '本机数据库操作失败' }, { status: 409 });
  }
}
