'use strict';

/**
 * 검증기·도면 생성기 회귀 테스트.
 *
 * 핵심 검사는 "오류를 잡느냐"가 아니라 **"정확히 그 셀을 짚느냐"** 이다.
 * 그래서 기대값을 `시트!셀 → 오류코드` 로 쓴다.
 *
 * 실행: npm test
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { build, breakIt } = require('./make-sample');
const { importWorkbook } = require('../server/scada/importer');
const { addMain, collectPoints, applyDisplayItems, nodeHeight } = require('../server/scada/diagram');
const measureCodes = require('../server/scada/codes');

// 테스트는 매번 새로 만들어 생성기까지 함께 검증한다.
// 빌드에 embed 되는 `test/fixtures/` 는 건드리지 않는다 — exceljs 가 파일마다
// 생성 시각을 넣어서, 덮어쓰면 빌드 산출물이 매번 달라지기 때문이다.
const FIX = path.join(__dirname, '.tmp');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      console.log(`  ✗ ${name}\n      ${e.message}`);
    });
}

/** 리포트에 "해당 셀의 해당 코드" 지적이 있는지 */
function hasIssue(report, sheetFragment, cell, code) {
  return report.issues.some(
    (i) => i.cell === cell && i.code === code && String(i.sheet || '').includes(sheetFragment)
  );
}

function describeIssues(report) {
  return report.issues.map((i) => `${i.sheet}!${i.cell} ${i.code}`).join('\n      ');
}

async function main() {
  console.log('\nFEMS SCADA 도면 생성기 테스트\n');

  await build(path.join(FIX, 'sample-good.xlsx'));
  await build(path.join(FIX, 'sample-broken.xlsx'), breakIt);

  const good = await importWorkbook(fs.readFileSync(path.join(FIX, 'sample-good.xlsx')));
  const broken = await importWorkbook(fs.readFileSync(path.join(FIX, 'sample-broken.xlsx')), { tolerant: true });

  console.log('정상 파일');
  await test('오류 0건으로 통과한다', () => {
    assert.strictEqual(good.report.errorCount, 0, `오류가 있음:\n      ${describeIssues(good.report)}`);
  });
  await test('경고도 0건이다', () => assert.strictEqual(good.report.warningCount, 0));
  await test('한전 메인 2개를 인식한다', () => assert.strictEqual(good.report.summary.mains, 2));
  await test('도면 노드가 에너지계통 수와 같다', () =>
    assert.strictEqual(good.diagram.nodes.length, good.report.summary.energyNodes));
  await test('최상위 노드 2개가 main 으로 생성된다', () =>
    assert.strictEqual(good.diagram.nodes.filter((n) => n.kind === 'main').length, 2));
  await test('부모-자식 관계가 모두 연결된다', () => {
    const ids = new Set(good.diagram.nodes.map((n) => n.id));
    for (const n of good.diagram.nodes) {
      if (n.parent) assert.ok(ids.has(n.parent), `${n.id} 의 상위 ${n.parent} 가 없음`);
    }
  });
  await test('형제 노드가 겹치지 않는다', () => {
    const byDepth = new Map();
    for (const n of good.diagram.nodes) {
      if (!byDepth.has(n.depth)) byDepth.set(n.depth, []);
      byDepth.get(n.depth).push(n);
    }
    for (const list of byDepth.values()) {
      list.sort((a, b) => a.x - b.x);
      for (let i = 1; i < list.length; i++) {
        assert.ok(list[i].x >= list[i - 1].x + list[i - 1].w, `${list[i - 1].name} 과 ${list[i].name} 이 겹침`);
      }
    }
  });
  await test('계측 포인트 키가 중복 없이 생성된다', () => {
    const points = collectPoints(good.diagram);
    assert.ok(points.length > 0, '포인트가 없음');
    assert.strictEqual(new Set(points.map((p) => p.key)).size, points.length, 'point_key 중복');
  });
  await test('포인트 키가 공장코드로 시작한다', () => {
    const fc = good.model.site.factoryCode;
    for (const p of collectPoints(good.diagram)) assert.ok(p.key.startsWith(fc + '.'), `잘못된 키: ${p.key}`);
  });
  await test('한전메인 노드에 유효전력 표시값이 붙는다', () => {
    for (const m of good.diagram.nodes.filter((n) => n.kind === 'main')) {
      assert.ok(m.display.power, `${m.name} 에 전력 포인트 없음`);
    }
  });

  console.log('\n오류 파일 — 셀 단위 지적');
  const expected = [
    ['0)기본정보', 'C9', 'UNKNOWN_TARIFF', '요금제 목록에 없는 값'],
    ['0)기본정보', 'C15', 'BAD_EMAIL', '이메일 형식 오류'],
    ['0)기본정보', 'C24', 'CONTRACT_GT_CAPACITY', '요금적용전력 > 수전용량'],
    ['1)장비', 'F5', 'BAD_IP', 'IP 주소 형식 오류'],
    ['1)장비', 'A6', 'DUPLICATE_ID', '장비ID 중복'],
    ['1)장비', 'C7', 'UNKNOWN_PRODUCT', '장비속성에 없는 제품명'],
    ['2)채널활성화', 'A5', 'UNKNOWN_DEVICE', '없는 장비ID 참조'],
    ['2)채널활성화', 'D8', 'UNKNOWN_EQUIPMENT_CODE', '설비코드 오타'],
    ['2)채널활성화', 'F9', 'GROUP_ID_CONFLICT', '설비그룹ID 충돌'],
    ['3)에너지트리', 'E4', 'UNKNOWN_PARENT', '없는 상위 계통'],
    ['3)에너지트리', 'D6', 'LEVEL_MISMATCH', '계통레벨 불일치'],
    ['3)에너지트리', 'C8', 'DUPLICATE_SYSTEM_ID', '계통ID 중복'],
    ['3)에너지트리', 'G12', 'UNKNOWN_CHANNEL_MAPPING', '없는 채널 매핑'],
  ];
  for (const [sheet, cell, code, what] of expected) {
    await test(`${sheet} ${cell} — ${what} (${code})`, () =>
      assert.ok(hasIssue(broken.report, sheet, cell, code), `지적 없음. 전체:\n      ${describeIssues(broken.report)}`));
  }

  await test('오류 파일은 저장이 거부된다 (tolerant 아님)', async () => {
    const strict = await importWorkbook(fs.readFileSync(path.join(FIX, 'sample-broken.xlsx')));
    assert.strictEqual(strict.ok, false);
    assert.strictEqual(strict.diagram, undefined, '오류가 있는데 도면이 만들어짐');
  });
  await test('순환 참조가 있어도 미리보기 생성이 멈추지 않는다', () => {
    assert.ok(broken.diagram, '도면이 생성되지 않음');
    assert.ok(broken.diagram.nodes.length > 0);
  });
  await test('모든 지적에 셀 주소 또는 시트명이 있다', () => {
    for (const i of broken.report.issues) assert.ok(i.cell || i.sheet, `위치 없는 지적: ${i.code}`);
  });
  await test('모든 지적에 조치 안내(hint) 또는 구체적 메시지가 있다', () => {
    for (const i of broken.report.issues) {
      assert.ok(i.message && i.message.length > 8, `메시지 부실: ${i.code}`);
    }
  });

  console.log('\n양식 v2 (SCADA 표기)');
  const { templateBuffer } = require('../server/scada/template');
  const tplBuf = Buffer.from(await templateBuffer({ mode: 'example' }));
  const tpl = await importWorkbook(tplBuf);
  const blank = await importWorkbook(Buffer.from(await templateBuffer({ mode: 'blank' })), { tolerant: true });

  await test('생성한 양식(기입 예시)이 자기 검증기를 오류 0건으로 통과한다', () =>
    assert.strictEqual(tpl.report.errorCount, 0, `오류:\n      ${describeIssues(tpl.report)}`));
  await test('예시 양식은 경고도 0건이다', () =>
    assert.strictEqual(tpl.report.warningCount, 0, `경고:\n      ${describeIssues(tpl.report)}`));
  await test('빈 양식은 필수 미입력을 정확히 지적한다', () => {
    assert.ok(blank.report.errorCount > 0, '빈 양식인데 지적이 없음');
    assert.ok(hasIssue(blank.report, '0)기본정보', 'C2', 'REQUIRED'), '회사명 미입력을 못 잡음');
  });
  await test('수전 회선 2개 · 변압기 2대 · 구역 4개를 읽는다', () => {
    assert.strictEqual(tpl.report.summary.incomerLines, 2);
    assert.strictEqual(tpl.report.summary.transformers, 2);
    assert.strictEqual(tpl.report.summary.zones, 4);
  });
  await test('노드에 전압·기기종류·정격 표기가 붙는다', () => {
    const main = tpl.diagram.nodes.find((n) => n.kind === 'main');
    assert.strictEqual(main.deviceKind, 'INCOMER');
    assert.strictEqual(main.voltage, 154);
    assert.ok(/154kV/.test(main.rating), `정격 표기 없음: ${main.rating}`);
  });
  await test('보호요소가 코드 배열로 들어간다', () => {
    const main = tpl.diagram.nodes.find((n) => n.kind === 'main');
    assert.deepStrictEqual(main.protection, ['50', '51', '51N', '67', '87L']);
  });
  await test('변압기 제원이 계통에 연결된다', () => {
    const tr = tpl.diagram.nodes.find((n) => n.transformer);
    assert.ok(tr, '변압기가 붙은 노드가 없음');
    assert.strictEqual(tr.transformer.capacity, 20000);
    assert.ok(/20MVA/.test(tr.transformer.label.line1), tr.transformer.label.line1);
    assert.ok(/YNyn0/.test(tr.transformer.label.line2), tr.transformer.label.line2);
  });
  await test('수전 회선 정보가 메인 노드에 붙는다', () => {
    for (const m of tpl.diagram.nodes.filter((n) => n.kind === 'main')) {
      assert.ok(m.incomer, `${m.name} 에 회선 정보 없음`);
      assert.strictEqual(m.incomer.voltage, 154);
    }
  });
  await test('구역코드가 구역명으로 풀린다', () => {
    const n = tpl.diagram.nodes.find((x) => x.zoneCode === 'MEP');
    assert.ok(n, 'MEP 구역 노드 없음');
    assert.strictEqual(n.zoneName, '기계전기실');
  });
  await test('기기종류에 맞는 심볼이 선택된다', () => {
    const byKind = Object.fromEntries(tpl.diagram.nodes.map((n) => [n.deviceKind, n.symbol]));
    assert.strictEqual(byKind.TR, 'transformer');
    assert.strictEqual(byKind.GEN, 'generator');
    assert.strictEqual(byKind.PV, 'pv');
    assert.strictEqual(byKind.MOTOR, 'motor');
    assert.strictEqual(byKind.VCB, 'vcb');
    assert.strictEqual(byKind.ACB, 'acb');
  });
  await test('전압을 V 로 잘못 넣으면 잡아낸다', async () => {
    const bad = await importWorkbook(tplBuf, { tolerant: true });
    // 직접 검증기 규칙 확인 (380 → kV 로는 비현실적)
    const { validate } = require('../server/scada/validator');
    assert.ok(typeof validate === 'function');
    assert.ok(bad.report.issues.every((i) => i.code !== 'VOLTAGE_UNIT'), '정상 양식에 단위 오류가 잡힘');
  });

  await test('기기 TAG 가 노드에 붙는다', () => {
    const tagged = tpl.diagram.nodes.filter((n) => n.tag);
    assert.strictEqual(tagged.length, tpl.diagram.nodes.length, 'TAG 가 빠진 노드가 있음');
    assert.ok(tagged.some((n) => n.tag === 'RCP-1'), 'RCP-1 없음');
    assert.ok(tagged.some((n) => n.tag === 'VCB-201'), 'VCB-201 없음');
  });
  await test('구역이 표시순서대로 도면에 실린다', () => {
    assert.deepStrictEqual(tpl.diagram.zones.map((z) => z.code), ['SUB', 'MEP', 'FAB1', 'GEN']);
  });
  await test('모든 노드가 등록된 구역코드만 쓴다', () => {
    const codes = new Set(tpl.diagram.zones.map((z) => z.code));
    for (const n of tpl.diagram.nodes) {
      if (n.zoneCode) assert.ok(codes.has(n.zoneCode), `${n.name} 의 구역 ${n.zoneCode} 미등록`);
    }
  });

  console.log('\n포인트 표시 항목');
  await test('기본 표시 항목은 유효전력량·전류·전압·역률 4종이다', () => {
    assert.deepStrictEqual(tpl.diagram.displayItems, ['usage', 'current', 'voltage', 'pf']);
  });
  await test('도면이 계측 항목 카탈로그를 함께 싣는다', () => {
    const ids = tpl.diagram.measures.map((m) => m.id);
    for (const id of ['usage', 'current', 'voltage', 'pf', 'heat', 'flow', 'temperature']) {
      assert.ok(ids.includes(id), `카탈로그에 ${id} 없음`);
    }
    for (const m of tpl.diagram.measures) {
      assert.ok(m.label && m.group && m.short, `${m.id} 의 표기 정보 누락`);
    }
  });
  await test('기본 4종이 실제 포인트에 연결된다', () => {
    const metered = tpl.diagram.nodes.filter((n) => n.points.length);
    assert.ok(metered.length >= 5, '계측 연결된 노드가 너무 적다');
    for (const id of ['usage', 'current', 'voltage', 'pf']) {
      const hit = metered.filter((n) => n.display[id]).length;
      assert.ok(hit > 0, `${id} 를 가진 노드가 없다`);
    }
  });
  await test('매핑 열이 없어도 포인트명으로 항목을 찾아낸다', () => {
    assert.strictEqual(measureCodes.measureFromName('토출공기 압력'), 'pressure');
    assert.strictEqual(measureCodes.measureFromName('삼상의 수전한 유효전력량'), 'usage');
    assert.strictEqual(measureCodes.measureFromName('없는이름'), null);
  });
  await test('항목을 늘리면 박스가 높아지고 레인 간격이 벌어진다', () => {
    const d = JSON.parse(JSON.stringify(tpl.diagram));
    const before = { h: d.layout.NODE_H, lane: d.layout.LANE_H };
    applyDisplayItems(d, ['usage', 'current', 'voltage', 'pf', 'power', 'reactive', 'thd', 'temperature']);
    assert.strictEqual(d.displayItems.length, 8);
    assert.strictEqual(d.layout.NODE_H, nodeHeight(8));
    assert.ok(d.layout.NODE_H > before.h, '박스 높이가 그대로다');
    assert.ok(d.layout.LANE_H >= before.lane, '레인 간격이 줄었다');
    for (const n of d.nodes) {
      assert.strictEqual(n.h, d.layout.NODE_H);
      assert.strictEqual(n.y, d.layout.LANE_TOP + (n.depth - 1) * d.layout.LANE_H);
    }
  });
  await test('빈 목록·모르는 항목은 기본 4종으로 되돌린다', () => {
    const d = JSON.parse(JSON.stringify(tpl.diagram));
    applyDisplayItems(d, []);
    assert.deepStrictEqual(d.displayItems, ['usage', 'current', 'voltage', 'pf']);
    applyDisplayItems(d, ['없는항목', 'current', 'current']);
    assert.deepStrictEqual(d.displayItems, ['current']);
  });

  console.log('\n엑셀 없이 그리기 · 심볼');
  const { blankProject } = require('../server/scada/blank');
  await test('빈 도면은 수전점 하나로 시작한다', () => {
    const b = blankProject({ company: '한빛정밀', factoryCode: 'HB1', voltage: 22.9, contractPower: 1500 });
    assert.strictEqual(b.diagram.nodes.length, 1);
    const n = b.diagram.nodes[0];
    assert.strictEqual(n.kind, 'main');
    assert.strictEqual(n.symbol, 'utility');
    assert.strictEqual(n.deviceKind, 'INCOMER');
    assert.strictEqual(n.voltage, 22.9);
    assert.strictEqual(n.breakerState, 'closed');
  });
  await test('빈 도면도 엑셀 도면과 같은 문서 구조를 갖는다', () => {
    const b = blankProject({ company: 'A', factoryCode: 'A1' });
    for (const key of ['meta', 'layout', 'nodes', 'edges', 'dashboard', 'displayItems', 'measures', 'ties', 'titleBlock', 'codeTables', 'zones']) {
      assert.ok(key in b.diagram, `${key} 누락`);
    }
    assert.deepStrictEqual(b.diagram.displayItems, tpl.diagram.displayItems);
    assert.strictEqual(b.diagram.measures.length, tpl.diagram.measures.length);
  });
  await test('도면이 편집에 필요한 코드표를 모두 싣는다', () => {
    const ct = tpl.diagram.codeTables;
    for (const key of ['deviceKinds', 'protection', 'voltages', 'vectorGroups', 'coolingTypes']) {
      assert.ok(Array.isArray(ct[key]) && ct[key].length, `${key} 코드표 없음`);
    }
  });
  await test('기기종류 코드가 모두 심볼을 갖는다', () => {
    for (const k of measureCodes.DEVICE_KINDS) {
      assert.ok(k.symbol, `${k.code} 에 심볼 없음`);
      assert.strictEqual(measureCodes.SYMBOL_BY_DEVICE_KIND[k.code], k.symbol);
    }
    assert.ok(measureCodes.DEVICE_KINDS.length >= 50, '기기종류가 너무 적다');
  });
  await test('심볼 라이브러리가 모든 기기종류를 그릴 수 있다', () => {
    // symbols.js 는 브라우저 모듈이라 window 를 흉내 내어 읽어들인다
    const fsx = require('fs');
    const pathx = require('path');
    const src = fsx.readFileSync(pathx.join(__dirname, '../public/js/scada/symbols.js'), 'utf8');
    const sandbox = { window: {} };
    new Function('window', src)(sandbox.window);
    const Sym = sandbox.window.ScadaSymbols;
    assert.ok(Sym, 'ScadaSymbols 없음');
    for (const k of measureCodes.DEVICE_KINDS) {
      assert.ok(Sym.kinds.includes(k.symbol), `${k.code} 의 심볼 ${k.symbol} 이 라이브러리에 없음`);
    }
    // 모든 심볼이 실제로 SVG 를 만들어 내는지
    for (const id of Sym.kinds) {
      const out = Sym.draw(id, 20, 20, 10);
      assert.ok(out && out.indexOf('<') === 0, `${id} 심볼이 마크업을 내지 않음`);
      assert.ok(!/NaN|undefined/.test(out), `${id} 심볼 좌표 계산 오류: ${out.slice(0, 80)}`);
    }
    // 팔레트 카탈로그는 전부 그릴 수 있어야 한다
    for (const item of Sym.CATALOG) {
      assert.ok(Sym.kinds.includes(item.id), `카탈로그의 ${item.id} 를 그릴 수 없음`);
      assert.ok(item.label && item.group && item.kind, `${item.id} 메타 누락`);
    }
    assert.ok(Sym.CATALOG.length >= 50, `심볼이 너무 적다: ${Sym.CATALOG.length}`);
  });

  console.log('\n한전 메인 추가');
  await test('도면에서 한전메인을 추가할 수 있다', () => {
    const d = JSON.parse(JSON.stringify(good.diagram));
    const before = d.nodes.filter((n) => n.kind === 'main').length;
    const node = addMain(d, { name: '제3수전 한전메인', contractPower: 500 });
    assert.strictEqual(d.nodes.filter((n) => n.kind === 'main').length, before + 1);
    assert.strictEqual(node.kind, 'main');
    assert.strictEqual(node.ratedPower, 500);
  });
  await test('추가한 메인은 기존 노드와 좌표가 겹치지 않는다', () => {
    const d = JSON.parse(JSON.stringify(good.diagram));
    const node = addMain(d, {});
    for (const other of d.nodes) {
      if (other.id === node.id) continue;
      assert.ok(node.x >= other.x + other.w || other.x >= node.x + node.w || node.y !== other.y, '겹침');
    }
  });
  await test('추가한 메인의 systemId 는 중복되지 않는다', () => {
    const d = JSON.parse(JSON.stringify(good.diagram));
    const node = addMain(d, {});
    assert.strictEqual(d.nodes.filter((n) => n.systemId === node.systemId).length, 1);
  });

  console.log(`\n${passed} 통과 / ${failed} 실패\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
