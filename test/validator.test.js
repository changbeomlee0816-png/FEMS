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
const { addMain, collectPoints } = require('../server/scada/diagram');

const FIX = path.join(__dirname, 'fixtures');

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
