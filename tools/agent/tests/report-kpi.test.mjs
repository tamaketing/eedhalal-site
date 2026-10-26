// KPI layout rules from docs/agent-kpi.md:
//   1. a measurable KPI carries a value AND its source;
//   2. a source the system has no data for is listed under รอข้อมูล — never a 0;
//   3. a live-unavailable service is reported with the reason, never guessed.
// buildKpiLayout is the pure part of tools/agent/report.mjs that enforces these.
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildKpiLayout } from '../report.mjs';

const ALL_DOWN = {
  inbox: { available: false, reason: 'Internal API ไม่ได้ทำงาน' },
  pipeline: { quotation: { available: false, reason: 'Internal API ไม่ได้ทำงาน' }, funnel: { available: false, reason: 'Internal API ไม่ได้ทำงาน' } },
  kpiSources: {
    systemChecks: { ok: false, reason: 'ตัวตรวจล้มเหลว (exit 1) — tools/agent/checks.mjs' },
    businessSync: { ok: false, reason: 'ตัวตรวจล้มเหลว (exit 1) — scripts/check-business-sync.mjs' },
    searchDiscovery: { ok: false, reason: 'ตัวตรวจล้มเหลว (exit 1) — scripts/check-search-discovery.mjs' },
    ownerCostsFile: { available: false, reason: 'ยังไม่มีไฟล์ต้นทุน demo/owner-set-builder/owner-costs.json' },
  },
};

test('when every source is down the report invents no numbers', () => {
  const kpi = buildKpiLayout(ALL_DOWN);
  assert.equal(kpi.measured.length, 0, 'no value without a working source');
  assert.ok(kpi.unavailable.length >= 1, 'live-unavailable sources are named with the reason');
  for (const row of kpi.unavailable) {
    assert.equal(row.length, 3, 'unavailable rows carry no numeric slot');
    assert.ok(typeof row[2] === 'string' && row[2].length > 0);
  }
  assert.ok(kpi.pending.length >= 1, 'no-source KPIs stay listed as รอข้อมูล');
  for (const row of kpi.pending) {
    assert.equal(row.length, 3, 'pending rows carry no numeric slot');
    assert.ok(/ยังไม่มีแหล่งข้อมูล|รอ/.test(row[2]), 'the reason names the missing source, not a guess');
  }
});

test('measured rows always carry the value and the source together', () => {
  const kpi = buildKpiLayout({
    inbox: { available: true, waiting: 3 },
    pipeline: {
      funnel: { available: true, counts: { NEW: 2, QUALIFIED: 1 } },
      quotation: { available: true, waiting: 5, ready: 3 },
    },
    kpiSources: {
      systemChecks: { ok: true, total: 12 },
      businessSync: { ok: true },
      searchDiscovery: { ok: true, pages: 91 },
      ownerCostsFile: { available: false, reason: 'ยังไม่มีไฟล์ต้นทุน' },
    },
  });
  const byKpi = new Map(kpi.measured.map((row) => [row.kpi, row]));

  const drafts = byKpi.get('draft ที่รอเจ้าของตอบ');
  assert.equal(drafts.value, 3);
  assert.match(drafts.source, /WAITING_FOR_HUMAN/);

  const funnel = byKpi.get('งานที่ค้างในแต่ละสถานะ (funnel)');
  assert.deepEqual(funnel.value, { NEW: 2, QUALIFIED: 1 });
  assert.match(funnel.source, /\/api\/v1\/leads/);

  const quotation = byKpi.get('ความครบถ้วนของข้อมูลที่ดึงได้');
  assert.deepEqual(quotation.value, { waiting: 5, ready: 3, incomplete: 2 });
  assert.match(quotation.source, /\/api\/v1\/quotations/);

  assert.equal(byKpi.get('การค้นหามองเห็นเว็บ (จำนวนหน้าที่ผ่าน)').value, 91);
  assert.equal(byKpi.get('ตัวตรวจระบบผลักผ่านทั้งหมด').value, 12);
  assert.equal(byKpi.get('ข้อมูลธุรกิจตรงกันทุกช่องทาง').value, 'ผ่าน');

  // The owner cost file is still missing: A05 stays without any number.
  assert.ok(!kpi.measured.some((row) => row.position.startsWith('A05')), 'A05 has no source yet');
  assert.ok(kpi.unavailable.some((row) => row[0].startsWith('A05')), 'A05 is listed as ยังไม่มีแหล่งข้อมูล');
});

test('an over-claimed ready count never turns into a negative gap', () => {
  const kpi = buildKpiLayout({
    ...ALL_DOWN,
    pipeline: { quotation: { available: true, waiting: 2, ready: 5 }, funnel: ALL_DOWN.pipeline.funnel },
  });
  const quotation = kpi.measured.find((row) => row.kpi === 'ความครบถ้วนของข้อมูลที่ดึงได้');
  assert.deepEqual(quotation.value, { waiting: 2, ready: 5, incomplete: 0 });
});
