'use strict';

const codes = require('./codes');

/**
 * 정규 모델 → SCADA 단선결선도(SLD) 도면 문서.
 *
 * 산출물은 순수 데이터(JSON)다. 렌더링은 전적으로 클라이언트가 담당하고,
 * 서버는 "무엇을 어디에 그릴지"만 결정한다. 덕분에
 *  - 도면을 DB 에 그대로 저장/버전관리할 수 있고
 *  - 사용자가 편집한 좌표를 되돌려 저장할 수 있으며
 *  - 나중에 FEMS 본 시스템이 같은 JSON 을 받아 자기 화면에 그릴 수 있다.
 */

/** 노드 박스 안쪽 치수 — 계측값을 몇 줄 넣느냐에 따라 높이가 달라진다 */
const HEAD_H = 40;    // 이름 + 부제 영역
const VAL_ROW_H = 15; // 계측값 한 줄
const VAL_COLS = 2;   // 계측값은 2열로 배치한다
const VAL_PAD = 8;    // 마지막 줄 아래 여백

/** 표시 항목 개수 → 노드 박스 높이 */
function nodeHeight(count) {
  const rows = Math.max(1, Math.ceil((count || 1) / VAL_COLS));
  return HEAD_H + rows * VAL_ROW_H + VAL_PAD;
}

/** 박스가 커지면 레인 간격도 같이 벌린다 (모선·차단기 자리를 확보) */
function laneHeight(nodeH) {
  return Math.max(205, nodeH + 127);
}

const LAYOUT = {
  NODE_W: 172,
  NODE_H: nodeHeight(codes.DEFAULT_DISPLAY_ITEMS.length),
  HEAD_H,
  VAL_ROW_H,
  VAL_COLS,
  VAL_PAD,
  LEAF_W: 208,
  LANE_TOP: 210, // 1레벨(한전 메인) 박스 상단 — 위쪽에 수전/MOF 심볼 자리를 비워둔다
  LANE_H: laneHeight(nodeHeight(codes.DEFAULT_DISPLAY_ITEMS.length)),
  MAIN_GAP: 150,
  PAD_X: 70,
  PAD_BOTTOM: 120,
  BUS_OFFSET: 46, // 박스 하단 ~ 모선 사이 간격
};

/** 계통명 키워드로 심볼을 추정한다 (설비코드가 비어 있는 통합/그룹 계통용). */
function symbolFromName(name) {
  const n = String(name || '');
  if (/한전|수전|메인|main/i.test(n)) return 'utility';
  if (/수배전|배전반|판넬|panel|mcc/i.test(n)) return 'switchgear';
  if (/태양광|pv|solar/i.test(n)) return 'pv';
  if (/압축|컴프|compressor|펌프|pump|팬|fan|송풍/i.test(n)) return 'motor';
  if (/보일러|히트펌프|열교환|온수/i.test(n)) return 'heat';
  if (/로$|소성|용해|용탕|furnace/i.test(n)) return 'furnace';
  if (/사출|압출|성형|프레스|인쇄|절삭|mct/i.test(n)) return 'machine';
  return null;
}

function symbolFor({ level, hasChildren, equipmentCode, name, deviceKind }) {
  // v2 의 기기종류가 있으면 그것이 가장 정확하다
  if (deviceKind && codes.SYMBOL_BY_DEVICE_KIND[deviceKind]) return codes.SYMBOL_BY_DEVICE_KIND[deviceKind];
  if (level === 1) return 'utility';
  if (equipmentCode && codes.SYMBOL_BY_EQUIPMENT[equipmentCode]) return codes.SYMBOL_BY_EQUIPMENT[equipmentCode];
  const guess = symbolFromName(name);
  if (guess) return guess;
  return hasChildren ? 'switchgear' : 'load';
}

/** 정격 표기 문자열 — 사진의 "24kV 1250A 25kA" 같은 한 줄 */
function ratingLabel({ voltage, ratedCurrent, breakingCapacity }) {
  const parts = [];
  if (voltage != null) parts.push(voltage >= 1 ? `${voltage}kV` : `${Math.round(voltage * 1000)}V`);
  if (ratedCurrent != null) parts.push(`${ratedCurrent}A`);
  if (breakingCapacity != null) parts.push(`${breakingCapacity}kA`);
  return parts.join(' ');
}

/** 변압기 제원 두 줄 — "154/22.9kV 100MVA" + "YNyn0 %Z13 ONAN" */
function transformerLabel(tr) {
  if (!tr) return null;
  const kva = tr.capacity;
  const cap = kva == null ? null : kva >= 1000 ? `${+(kva / 1000).toFixed(kva % 1000 ? 1 : 0)}MVA` : `${kva}kVA`;
  const line1 = [
    tr.primaryVoltage != null && tr.secondaryVoltage != null ? `${tr.primaryVoltage}/${tr.secondaryVoltage}kV` : null,
    cap,
  ].filter(Boolean).join(' ');
  const line2 = [tr.vectorGroup, tr.impedance != null ? `%Z${tr.impedance}` : null, tr.cooling]
    .filter(Boolean).join(' ');
  return { line1, line2 };
}

/** 노드 상태 판정·차트에 쓰는 대표 역할 (표시 항목과는 별개) */
const DISPLAY_ROLES = ['power', 'current', 'voltage', 'pf', 'usage'];

/**
 * 노드에 붙은 계측 포인트를 "계측 항목(measure)" 별로 정리한다.
 *
 * 1순위는 4)장비속성의 매핑 열(O 표시)로 들어온 role,
 * 2순위는 포인트명 추정(measureFromName)이다. 그래서 매핑 열이 없는
 * 열량·유량·온도 같은 포인트도 도면에 올릴 수 있다.
 *
 * 결과 키는 계측 항목 id 이고, role 이름과 같은 체계라 기존 코드
 * (`display.power` 등)는 그대로 동작한다.
 */
function resolveMeasures(points) {
  const out = {};
  // 1) 매핑 열로 지정된 역할
  for (const p of points) {
    for (const role of p.roles || []) {
      if (codes.MEASURE_BY_ID[role] && !out[role]) out[role] = { key: p.key, unit: p.unit, name: p.name };
    }
  }
  // 2) 이름으로 추정 (이미 채워진 항목은 건드리지 않는다)
  for (const p of points) {
    const id = codes.measureFromName(p.name);
    if (id && !out[id]) out[id] = { key: p.key, unit: p.unit, name: p.name };
  }
  return out;
}

/** 도면에 표시할 계측 항목 목록 정리 — 미지의 id 는 버리고, 비면 기본값 */
function normalizeDisplayItems(items) {
  const seen = new Set();
  const use = [];
  for (const id of items || []) {
    if (codes.MEASURE_BY_ID[id] && !seen.has(id)) {
      seen.add(id);
      use.push(id);
    }
  }
  return use.length ? use : codes.DEFAULT_DISPLAY_ITEMS.slice();
}

/**
 * 표시 항목 변경 적용 — 항목 수가 바뀌면 박스 높이와 레인 간격을 다시 잡는다.
 * (화면의 "표시 항목" 메뉴와 서버 API 가 같은 규칙을 쓰도록 여기에 둔다)
 */
function applyDisplayItems(diagram, items) {
  const use = normalizeDisplayItems(items);
  diagram.displayItems = use;

  const h = nodeHeight(use.length);
  if (h === diagram.layout.NODE_H) return diagram; // 줄 수가 그대로면 배치를 건드리지 않는다

  const lane = laneHeight(h);
  const top = diagram.layout.LANE_TOP;
  diagram.layout.NODE_H = h;
  diagram.layout.LANE_H = lane;

  let maxDepth = 1;
  for (const n of diagram.nodes) {
    n.h = h;
    n.y = top + ((n.depth || 1) - 1) * lane;
    maxDepth = Math.max(maxDepth, n.depth || 1);
  }
  diagram.layout.maxDepth = maxDepth;
  diagram.layout.canvasH = top + maxDepth * lane + LAYOUT.PAD_BOTTOM;
  return diagram;
}

/**
 * 도면 생성.
 * @param {object} model  model.buildModel() 결과
 * @param {object} [opts] { name }
 */
function buildDiagram(model, opts = {}) {
  const lookup = model.__lookup;

  // 각 포인트에 무엇을 표시할지 — 기본은 유효전력량·전류·전압·역률 4종.
  // 나머지 계측 항목은 화면의 "표시 항목" 메뉴에서 켠다.
  const displayItems = normalizeDisplayItems(opts.displayItems);
  const nodeH = nodeHeight(displayItems.length);
  const laneH = laneHeight(nodeH);

  // 오류가 있는 파일도 미리보기를 만들 수 있어야 한다(tolerant 모드).
  // 중복 ID·자기참조·순환은 검증기가 이미 지적했으므로, 여기서는 배치가
  // 무한 재귀에 빠지지 않도록 트리를 안전한 형태로 정리만 한다.
  const byId = new Map();
  const tree = [];
  for (const n of model.energyTree) {
    if (n.systemId == null || byId.has(n.systemId)) continue; // 중복 ID 는 첫 행만 채택
    byId.set(n.systemId, n);
    tree.push(n);
  }

  /** 조상을 거슬러 올라가 순환에 걸리는 노드는 최상위로 끌어올린다. */
  function effectiveParent(n) {
    if (n.parentId === n.systemId || !byId.has(n.parentId)) return 0;
    const seen = new Set([n.systemId]);
    let cur = byId.get(n.parentId);
    while (cur) {
      if (seen.has(cur.systemId)) return 0; // 순환 → 루트로 분리
      seen.add(cur.systemId);
      cur = byId.has(cur.parentId) ? byId.get(cur.parentId) : null;
    }
    return n.parentId;
  }

  const childrenOf = new Map();
  for (const n of tree) {
    const pid = effectiveParent(n);
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(n);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.systemId - b.systemId);

  const roots = childrenOf.get(0) || [];

  // ── 좌표 배치 (leaf 슬롯 폭 기반 tidy layout) ──────────────────
  const cx = new Map();
  function assign(node, x0) {
    const kids = childrenOf.get(node.systemId) || [];
    if (kids.length === 0) {
      cx.set(node.systemId, x0 + LAYOUT.LEAF_W / 2);
      return LAYOUT.LEAF_W;
    }
    let cursor = x0;
    let total = 0;
    for (const k of kids) {
      const w = assign(k, cursor);
      cursor += w;
      total += w;
    }
    cx.set(node.systemId, x0 + total / 2);
    return total;
  }

  let cursor = LAYOUT.PAD_X;
  const mainRegions = [];
  for (const root of roots) {
    const w = assign(root, cursor);
    mainRegions.push({ systemId: root.systemId, x0: cursor, x1: cursor + w });
    cursor += w + LAYOUT.MAIN_GAP;
  }
  const canvasW = Math.max(cursor - LAYOUT.MAIN_GAP + LAYOUT.PAD_X, 1200);

  // ── 노드 생성 ──────────────────────────────────────────────────
  const nodes = [];
  const edges = [];
  let maxDepth = 1;

  function walk(node, depth, mainId) {
    maxDepth = Math.max(maxDepth, depth);
    const kids = childrenOf.get(node.systemId) || [];
    const channel = lookup.channelByKey.get(`${node.deviceId}-${node.channel}`) || null;
    const device = lookup.deviceById.get(node.deviceId) || null;
    const points = lookup.pointsFor(node.deviceId, node.channel);

    const id = `n${node.systemId}`;
    const x = Math.round(cx.get(node.systemId) - LAYOUT.NODE_W / 2);
    const y = LAYOUT.LANE_TOP + (depth - 1) * laneH;

    nodes.push({
      id,
      systemId: node.systemId,
      mainId,
      kind: depth === 1 ? 'main' : kids.length ? 'group' : 'load',
      symbol: symbolFor({
        level: depth,
        hasChildren: kids.length > 0,
        equipmentCode: channel && channel.equipmentCode,
        name: node.name,
        deviceKind: node.deviceKind,
      }),
      name: node.name,
      depth,
      x,
      y,
      w: LAYOUT.NODE_W,
      h: nodeH,
      parent: node.parentId && byId.has(node.parentId) ? `n${node.parentId}` : null,
      energySource: node.energySource,
      energySourceName: node.energySourceName,
      device: device
        ? { deviceId: device.deviceId, productName: device.productName, ip: device.ip, location: device.location, active: device.active }
        : null,
      channel: node.channel,
      facility: channel
        ? { loadName: channel.loadName, equipmentCode: channel.equipmentCode, groupId: channel.groupId, groupName: channel.groupName, facilityId: channel.facilityId, facilityName: channel.facilityName }
        : null,
      // 도면에서 바로 편집 가능한 정격값.
      // v2 로 정격용량을 적었으면 그 값이 우선하고, 없으면 기존처럼 계약전력을 쓴다.
      ratedPower: node.ratedPower != null ? node.ratedPower : depth === 1 ? model.site.contractPower : null,
      capacity: depth === 1 ? model.site.receivingCapacity : null,

      // ── v2 : 실제 SCADA 표기용 정보 ─────────────────────────────
      deviceKind: node.deviceKind || null,
      voltage: node.voltage != null ? node.voltage : null,
      rating: ratingLabel(node) || null,
      ratedCurrent: node.ratedCurrent != null ? node.ratedCurrent : null,
      breakingCapacity: node.breakingCapacity != null ? node.breakingCapacity : null,
      protection: node.protection && node.protection.length ? node.protection : [],
      zoneCode: node.zoneCode || null,
      tag: node.tag || null,
      zoneName: node.zoneCode && lookup.zoneByCode.has(node.zoneCode) ? lookup.zoneByCode.get(node.zoneCode).name : null,
      transformer: (() => {
        const tr = lookup.transformerBySystem.get(node.systemId);
        if (!tr) return null;
        return { ...tr, label: transformerLabel(tr) };
      })(),
      incomer: lookup.incomerBySystem.get(node.systemId) || null,

      points,
      display: resolveMeasures(points),
      locked: false,
      source: 'excel',
    });

    for (const k of kids) {
      edges.push({ id: `e${node.systemId}-${k.systemId}`, from: id, to: `n${k.systemId}`, kind: 'feeder', breaker: true });
      walk(k, depth + 1, mainId);
    }
  }

  for (const root of roots) walk(root, 1, `n${root.systemId}`);

  const canvasH = LAYOUT.LANE_TOP + maxDepth * laneH + LAYOUT.PAD_BOTTOM;

  // ── 대시보드 구성 ──────────────────────────────────────────────
  const mains = nodes.filter((n) => n.kind === 'main');
  const groups = nodes.filter((n) => n.kind === 'group');
  const loads = nodes.filter((n) => n.kind === 'load');

  const dashboard = {
    // 상단 KPI 스트립 — 한전 메인마다 카드 1장 (ETAP 화면의 G1~G6 스트립과 동일한 역할)
    mainCards: mains.map((m) => ({
      nodeId: m.id,
      name: m.name,
      contractPower: m.incomer && m.incomer.contractPower != null ? m.incomer.contractPower : model.site.contractPower,
      receivingCapacity: model.site.receivingCapacity,
      incomer: m.incomer || null,
      points: m.display,
    })),
    // 계통(레벨2) 부하 비교 막대
    loadSeries: groups.map((g) => ({ nodeId: g.id, name: g.name, powerKey: g.display.power ? g.display.power.key : null })),
    // 설비그룹 구성 도넛
    facilityGroups: model.facilityGroups.map((g) => ({ groupId: g.groupId, name: g.name, count: g.facilities.length })),
    counts: { mains: mains.length, groups: groups.length, loads: loads.length, points: nodes.reduce((a, n) => a + n.points.length, 0) },
  };

  return {
    version: 1,
    meta: {
      name: opts.name || `${model.site.company || model.site.factoryCode} SCADA 도면`,
      company: model.site.company,
      factoryCode: model.site.factoryCode,
      tariff: model.site.tariff,
      contractPower: model.site.contractPower,
      receivingCapacity: model.site.receivingCapacity,
      generatedAt: new Date().toISOString(),
      generator: 'FEMS SCADA Diagram Generator',
    },
    layout: { ...LAYOUT, NODE_H: nodeH, LANE_H: laneH, canvasW, canvasH, maxDepth },
    nodes,
    edges,
    dashboard,
    // 각 포인트에 표시할 계측 항목 + 메뉴에 올릴 전체 카탈로그
    displayItems,
    measures: codes.MEASURE_CATALOG,
    // 편집기 팔레트에 그대로 노출되는 코드표
    codeTables: model.codeTables,
    zones: model.zones || [],
  };
}

/**
 * 한전 메인(최상위 계통) 추가.
 *
 * "한 업체에 한전메인이 두 개일 수 있다" 는 요구사항의 구현체.
 * 도면에서 버튼 한 번으로 두 번째 수전점을 만들고, 그 아래로 계통을 붙여 나간다.
 */
function addMain(diagram, input = {}) {
  const existingMains = diagram.nodes.filter((n) => n.kind === 'main');
  const nextSystemId = Math.max(0, ...diagram.nodes.map((n) => n.systemId || 0)) + 1;
  const id = `n${nextSystemId}`;

  const rightEdge = diagram.nodes.length
    ? Math.max(...diagram.nodes.map((n) => n.x + n.w))
    : diagram.layout.PAD_X;

  const node = {
    id,
    systemId: nextSystemId,
    mainId: id,
    kind: 'main',
    symbol: 'utility',
    name: input.name || `한전 메인 ${existingMains.length + 1}`,
    depth: 1,
    x: Math.round(rightEdge + diagram.layout.MAIN_GAP),
    y: diagram.layout.LANE_TOP,
    w: diagram.layout.NODE_W,
    h: diagram.layout.NODE_H,
    parent: null,
    energySource: input.energySource != null ? input.energySource : 1,
    energySourceName: input.energySourceName || '전력',
    device: null,
    channel: input.channel != null ? input.channel : null,
    facility: null,
    ratedPower: input.contractPower != null ? input.contractPower : null,
    capacity: input.receivingCapacity != null ? input.receivingCapacity : null,
    points: [],
    display: {},
    locked: false,
    source: 'manual',
  };

  diagram.nodes.push(node);
  diagram.layout.canvasW = Math.max(diagram.layout.canvasW, node.x + node.w + diagram.layout.PAD_X);
  diagram.dashboard.mainCards.push({
    nodeId: id,
    name: node.name,
    contractPower: node.ratedPower,
    receivingCapacity: node.capacity,
    points: {},
  });
  diagram.dashboard.counts.mains = diagram.nodes.filter((n) => n.kind === 'main').length;
  return node;
}

/** 도면의 모든 계측 포인트를 평탄화 (FEMS points 테이블 등록용) */
function collectPoints(diagram) {
  const seen = new Map();
  for (const n of diagram.nodes) {
    for (const p of n.points || []) {
      if (!seen.has(p.key)) seen.set(p.key, { ...p, nodeId: n.id, nodeName: n.name });
    }
  }
  return [...seen.values()];
}

module.exports = {
  buildDiagram,
  addMain,
  collectPoints,
  applyDisplayItems,
  normalizeDisplayItems,
  nodeHeight,
  laneHeight,
  LAYOUT,
  symbolFor,
  DISPLAY_ROLES,
};
