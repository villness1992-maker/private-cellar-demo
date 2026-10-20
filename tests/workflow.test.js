import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoRequest } from '../src/demo-db.js';

async function state() {
  const response = await demoRequest('/api/state');
  assert.equal(response.status, 200);
  return response.json();
}

async function action(body) {
  const response = await demoRequest('/api/actions', { body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('seeded inventory, sale, consigned pickup and persistence', async () => {
  await demoRequest('/api/reset');
  let before = await state();
  assert.equal(before.wines.length, 26);
  assert.equal(before.bottles.length, 260);
  assert.equal(before.movements.length, 276);
  assert.equal(before.bottles.filter(b => b.status === 'in').length, 244);
  assert.equal(before.bottles.filter(b => b.status === 'in' && b.ownership === 'consigned').length, 14);

  const lafite = before.wines.find(w => w.name === '拉菲古堡' && w.vintage === 2019);
  const customer = before.parties.find(p => p.name === '张三');
  const sale = await action({ type: 'out', wineId: lafite.id, quantity: 2, destination: 'sale', partyId: customer.id, unitAmount: 15500, note: '演示订单' });
  assert.equal(sale.status, 200);
  assert.equal(sale.body.count, 2);
  let after = await state();
  assert.equal(after.bottles.filter(b => b.status === 'in').length, 242);
  const saleRows = after.movements.filter(m => m.tx_id === sale.body.tx);
  assert.equal(saleRows.length, 2);
  assert(saleRows.every(m => m.destination === 'sale' && m.party_name === '张三' && m.amount === 15500));

  const consigned = after.bottles.find(b => b.status === 'in' && b.ownership === 'consigned');
  const pickup = await action({ type: 'pickup', bottleId: consigned.id, ownerPartyId: consigned.owner_party_id });
  assert.equal(pickup.status, 200);
  after = await state();
  assert.equal(after.bottles.find(b => b.id === consigned.id).status, 'out');
  assert.equal(after.bottles.filter(b => b.status === 'in' && b.ownership === 'consigned').length, 13);
  const repeat = await action({ type: 'pickup', bottleId: consigned.id, ownerPartyId: consigned.owner_party_id });
  assert.equal(repeat.status, 409);
  assert.equal((await state()).movements.filter(m => m.bottle_id === consigned.id && m.action === 'out').length, 1);
});

test('selected bottle batch entry and reset', async () => {
  await demoRequest('/api/reset');
  const before = await state();
  const wine = before.wines[0];
  const result = await action({ type: 'in', wineId: wine.id, quantity: 3, selected: [1, 3], location: 'A区·01架·上层', ownership: 'self', unitCost: 1200 });
  assert.equal(result.status, 200);
  assert.equal(result.body.count, 2);
  let after = await state();
  assert.equal(after.bottles.length, 262);
  assert.equal(after.movements.filter(m => m.tx_id === result.body.tx).length, 2);
  await demoRequest('/api/reset');
  after = await state();
  assert.equal(after.bottles.length, 260);
});
