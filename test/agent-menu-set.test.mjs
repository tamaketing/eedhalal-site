// The agent-facing CLI around the owner's menu catalogue. These run against a
// throwaway admin server on port 0, so the real catalogue is never touched.
//
// Fixtures use invented names and prices only — never a real menu or real price
// paired with a real dish.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLocalServer } from '../tools/admin/server.mjs';
import {
  EDITABLE_FIELDS,
  adminPort,
  applyChanges,
  findMenu,
  parseChanges,
  readCentral,
  writeCentral,
} from '../tools/agent/menu-set.mjs';

const FIXTURE = {
  menus: [
    { id: 1, name: 'fixture alpha', price: 70, tier: 'classic', image: '', desc: '', badge: '', minPerMenu: 10, hidden: false, sortOrder: 1, showPrice: true },
    { id: 2, name: 'fixture beta', price: 180, tier: 'signature', image: '', desc: '', badge: '', minPerMenu: 10, hidden: false, sortOrder: 2, showPrice: true },
  ],
  toppings: [{ name: 'fixture egg', price: 10 }],
  sideItems: [],
  popular: [1],
};

async function withAdminServer(run) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'agent-menu-'));
  const server = createLocalServer({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const previousPort = process.env.EED_ADMIN_PORT;
  process.env.EED_ADMIN_PORT = String(port);
  try {
    const seed = await fetch(`http://127.0.0.1:${port}/menu-central`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify(FIXTURE),
    });
    assert.equal(seed.status, 200, `fixture seed failed: ${await seed.text()}`);
    return await run(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
    if (previousPort === undefined) delete process.env.EED_ADMIN_PORT;
    else process.env.EED_ADMIN_PORT = previousPort;
  }
}

// A test must never reach the owner's real admin server on 4185.
const REAL_ADMIN_PORT = 4185;

test('the admin port is read at call time so a test cannot hit the real tool', () => {
  assert.equal(adminPort({ EED_ADMIN_PORT: '5123' }), 5123);
  assert.equal(adminPort({}), REAL_ADMIN_PORT);
  assert.equal(adminPort({ EED_ADMIN_PORT: '5123' }, undefined), 5123);
});

test('a menu is found by id, by exact name and by partial name', () => {
  assert.equal(findMenu(FIXTURE, '2').name, 'fixture beta');
  assert.equal(findMenu(FIXTURE, 'fixture beta').id, 2);
  assert.equal(findMenu(FIXTURE, 'beta').id, 2);
  assert.equal(findMenu(FIXTURE, 'nothing here'), null);
  assert.equal(findMenu(FIXTURE, ''), null);
});

test('an unknown field is refused instead of silently ignored', () => {
  const { errors } = parseChanges(['cost=5']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /cost/);
});

test('invalid values are refused before anything is changed', () => {
  assert.match(parseChanges(['price=0']).errors[0], /ราคา/);
  assert.match(parseChanges(['price=abc']).errors[0], /ราคา/);
  assert.match(parseChanges(['tier=gold']).errors[0], /ระดับ/);
  assert.match(parseChanges(['minPerMenu=0']).errors[0], /ขั้นต่ำ/);
  assert.match(parseChanges(['name=']).errors[0], /ชื่อ/);
});

test('valid values are coerced to the stored type', () => {
  const { changes, errors } = parseChanges(['price=135.005', 'hidden=true', 'minPerMenu=15']);
  assert.deepEqual(errors, []);
  assert.equal(changes.price, 135.01);
  assert.equal(changes.hidden, true);
  assert.equal(changes.minPerMenu, 15);
});

test('only catalogue fields are editable', () => {
  for (const field of ['id', 'version', 'internalNote', 'noLock']) {
    assert.equal(EDITABLE_FIELDS[field], undefined, `${field} must not be editable`);
  }
});

test('applying changes reports what moved and leaves the original untouched', () => {
  const { changes } = parseChanges(['price=99', 'name=fixture renamed']);
  const { next, diff, newlyHidden } = applyChanges(FIXTURE, 1, changes);
  assert.deepEqual(diff.map((row) => row.field).sort(), ['name', 'price']);
  assert.equal(FIXTURE.menus[0].price, 70, 'source document must not be mutated');
  assert.equal(next.menus.find((menu) => menu.id === 1).price, 99);
  assert.deepEqual(newlyHidden, []);
});

test('hiding many menus at once is reported for a second confirmation', () => {
  const central = {
    ...FIXTURE,
    menus: FIXTURE.menus.map((menu, index) => ({ ...menu, id: index + 1, hidden: false })),
  };
  const { changes } = parseChanges(['hidden=true']);
  let newlyHidden = [];
  for (const menu of central.menus) {
    newlyHidden = newlyHidden.concat(applyChanges(central, menu.id, changes).newlyHidden);
  }
  assert.equal(newlyHidden.length, 2);
});

test('a write that is not the expected next version is refused', async () => {
  await withAdminServer(async () => {
    const central = await readCentral();
    await assert.rejects(
      () => writeCentral({ ...central, menus: [...central.menus] }, central.version + 99),
      /รุ่นไม่ตรงกับที่คาดไว้|บันทึกไม่สำเร็จ/,
    );
  });
});

test('a valid write bumps the version by exactly one', async () => {
  await withAdminServer(async () => {
    const central = await readCentral();
    const { changes } = parseChanges(['price=75']);
    const { next } = applyChanges(central, 1, changes);
    const saved = await writeCentral(next, Number(central.version));
    assert.equal(Number(saved.version), Number(central.version) + 1);
    const reread = await readCentral();
    assert.equal(reread.menus.find((menu) => menu.id === 1).price, 75);
  });
});