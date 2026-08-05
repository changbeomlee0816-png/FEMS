/* global window, document */
'use strict';

/**
 * 단선결선도 캔버스 — 렌더링 + 편집(선택·이동·확대·팬).
 *
 * 도면 문서(diagram JSON)만 있으면 그려지고, 사용자가 옮긴 좌표는 그대로
 * 문서에 반영된다. 실시간 값(live)은 별도로 주입되며 도면 구조와 섞이지 않는다.
 */
window.ScadaCanvas = (function () {
  const Sym = window.ScadaSymbols;
  const esc = Sym.esc;

  const STALE_MS = 10 * 60 * 1000; // 이 시간 이상 갱신 없으면 '미수신'으로 본다

  let svg = null;
  let host = null;
  let diagram = null;
  let live = { values: {} };
  let selectedId = null;
  let zoneFilter = ''; // '' = 전체. 선택 시 다른 구역은 흐리게 그린다.

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let onChange = () => {};
  let onSelect = () => {};
  let energized = new Set(); // 가압된 노드 id — render() 마다 다시 계산
  let showFrame = true;      // 표제란 · 범례 표시
  let tieFrom = null;        // 연락(TIE) 연결 대기 중인 시작 노드
  let pen = null;            // 트레이싱 펜 — 잡고 있으면 클릭한 자리에 그 심볼을 놓는다

  // ── 값 조회 ────────────────────────────────────────────────────
  function reading(key) {
    if (!key) return null;
    const r = live.values && live.values[key];
    if (!r || r.value == null) return null;
    const ts = r.ts ? new Date(r.ts.replace(' ', 'T') + (r.ts.endsWith('Z') ? '' : 'Z')).getTime() : 0;
    return { value: r.value, ts, stale: !ts || Date.now() - ts > STALE_MS };
  }

  /** 노드의 대표 표시값 (상태 판정·차트용 — 유효전력 우선) */
  function primary(node) {
    const order = ['power', 'usage', 'current', 'voltage'];
    for (const role of order) {
      const d = node.display && node.display[role];
      if (!d) continue;
      const r = reading(d.key);
      return { role, unit: d.unit || (role === 'power' ? 'kW' : ''), reading: r, name: d.name };
    }
    return null;
  }

  // ── 표시 항목 ──────────────────────────────────────────────────
  // 도면이 카탈로그를 들고 다니므로(서버·브라우저 공통) 화면은 그것만 보면 된다.
  // 예전에 저장된 도면(카탈로그 없음)을 위해 기본 4종만 여기에 남겨 둔다.
  const FALLBACK_MEASURES = [
    { id: 'usage', label: '유효전력량', short: '전력량', unit: 'kWh', group: '기본', default: true },
    { id: 'current', label: '전류', short: '전류', unit: 'A', group: '기본', default: true },
    { id: 'voltage', label: '전압', short: '전압', unit: 'V', group: '기본', default: true },
    { id: 'pf', label: '역률', short: 'PF', unit: '%', group: '기본', default: true },
  ];

  function catalog() {
    return (diagram && diagram.measures && diagram.measures.length) ? diagram.measures : FALLBACK_MEASURES;
  }

  function measureById(id) {
    return catalog().filter((m) => m.id === id)[0] || null;
  }

  /** 지금 노드마다 그려야 할 계측 항목 (없으면 카탈로그의 기본 항목) */
  function displayItems() {
    const wanted = (diagram && diagram.displayItems) || catalog().filter((m) => m.default).map((m) => m.id);
    return wanted.map(measureById).filter(Boolean);
  }

  /**
   * 값·단위 표기 — 22,967 V 보다 22.97 kV 가 관제 관례에 맞다.
   * (계측 원값은 그대로 두고 표기만 바꾼다)
   */
  function scaleValue(value, unit) {
    if (unit === 'V' && Math.abs(value) >= 1000) return { value: value / 1000, unit: 'kV' };
    if (unit === 'kWh' && Math.abs(value) >= 100000) return { value: value / 1000, unit: 'MWh' };
    return { value, unit };
  }

  /** 항목 하나의 현재 값 */
  function valueOf(node, item) {
    const d = node.display && node.display[item.id];
    if (!d) return { unit: item.unit, reading: null, linked: false };
    return { unit: d.unit || item.unit, reading: reading(d.key), linked: true, name: d.name };
  }

  /** 표시 항목 수에 따른 박스 높이 — 서버 diagram.js 와 같은 규칙 */
  function heightFor(count) {
    const L = (diagram && diagram.layout) || {};
    const cols = L.VAL_COLS || 2;
    const rows = Math.max(1, Math.ceil((count || 1) / cols));
    return (L.HEAD_H || 40) + rows * (L.VAL_ROW_H || 15) + (L.VAL_PAD || 8);
  }

  // ── 가압(활선) 판정 ────────────────────────────────────────────
  /**
   * 차단기 개폐 상태를 따라 전원이 어디까지 들어가는지 계산한다.
   *
   * 실제 관제화면이 하는 일 그대로다 — 차단기를 열면 그 아래 계통이
   * 즉시 정전(회색)으로 바뀌고, 모선 연락(TIE)을 투입하면 반대편 전원에서
   * 다시 살아난다. 도면이 "그림"이 아니라 "계통 상태"가 되는 지점.
   */
  function computeEnergized() {
    const set = new Set();
    if (!diagram) return set;
    const kids = new Map();
    for (const n of diagram.nodes) {
      if (!n.parent) continue;
      if (!kids.has(n.parent)) kids.set(n.parent, []);
      kids.get(n.parent).push(n);
    }
    const byId = new Map(diagram.nodes.map((n) => [n.id, n]));

    /** 상위에서 내려오는 급전 — 자기 차단기가 열려 있으면 여기서 끊긴다 */
    function feed(node) {
      if (!node || set.has(node.id) || node.breakerState === 'open') return;
      feedBus(node);
    }
    /**
     * 모선 급전 — 연락에서 들어오는 경로.
     * 수전 차단기가 열려 있어도 모선 자체는 반대편에서 가압되므로
     * 자기 차단기 상태를 따지지 않는다 (하위 분기는 각자 차단기를 따른다).
     */
    function feedBus(node) {
      if (!node || set.has(node.id)) return;
      set.add(node.id);
      for (const k of kids.get(node.id) || []) feed(k);
    }

    for (const n of diagram.nodes) if (!n.parent) feed(n);

    // 연락 차단기가 투입되어 있으면 반대편 모선에서 전원을 받는다 (고정점까지 반복)
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of diagram.ties || []) {
        if (t.state === 'open') continue;
        const a = byId.get(t.from);
        const b = byId.get(t.to);
        if (!a || !b) continue;
        if (set.has(a.id) && !set.has(b.id)) { feedBus(b); changed = true; }
        if (set.has(b.id) && !set.has(a.id)) { feedBus(a); changed = true; }
      }
    }
    return set;
  }

  const isLive = (node) => energized.has(node.id);

  /** 결선 색 — 가압/정전/알람 3종. 데이터 유무가 아니라 계통 상태로 칠한다. */
  function wireClass(node) {
    if (!isLive(node)) return '';
    const st = statusOf(node);
    if (st === 'alarm') return ' is-alarm';
    return st === 'live' || st === 'warn' ? ' is-live' : ' is-on';
  }

  /** 노드 상태 — 색상은 상태에만 쓰고, 항상 텍스트와 함께 표시한다. */
  function statusOf(node) {
    if (node.device && node.device.active === false) return 'inactive';
    if (!energized.has(node.id)) return 'dead';
    const p = primary(node);
    if (!p || !p.reading) return 'stale';
    if (p.reading.stale) return 'stale';
    const rated = Number(node.ratedPower);
    if (p.role === 'power' && rated > 0) {
      if (p.reading.value > rated) return 'alarm';
      if (p.reading.value > rated * 0.9) return 'warn';
    }
    return 'live';
  }

  const fmt = (v) => window.ScadaCharts.fmt(v);
  const clip = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));

  // ── 기하 계산 ──────────────────────────────────────────────────
  function childrenOf(id) {
    return diagram.nodes.filter((n) => n.parent === id);
  }

  function busOf(node) {
    const kids = childrenOf(node.id);
    if (!kids.length) return null;
    const xs = kids.map((k) => k.x + k.w / 2);
    const y = node.y + node.h + (diagram.layout.BUS_OFFSET || 46);
    return {
      y,
      x1: Math.min(...xs, node.x + node.w / 2) - 14,
      x2: Math.max(...xs, node.x + node.w / 2) + 14,
      kids,
    };
  }

  /**
   * 조작 가능한 차단기 글리프.
   * 클릭하면 투입/개방이 바뀌고 그 아래 계통의 가압 상태가 즉시 따라온다.
   */
  function breakerGlyph(node, cx, cy, size) {
    const open = node.breakerState === 'open';
    const cls = open ? '' : isLive(node) ? ' is-hot' : ' is-cold';
    return `<g class="cb-hit" data-cb="${esc(node.id)}" role="button" tabindex="0"
              aria-label="${esc(node.name)} 차단기 ${open ? '개방' : '투입'}">
        <rect x="${cx - size}" y="${cy - size}" width="${size * 2}" height="${size * 2}" fill="transparent" />
        ${Sym.breaker(cx, cy, size, !open).replace('class="cb ', `class="cb${cls} `)}
        <title>${esc(node.name)} — 차단기 ${open ? '개방(OPEN)' : '투입(CLOSED)'} · 클릭하여 조작</title>
      </g>`;
  }

  // ── 렌더링 ─────────────────────────────────────────────────────
  function render() {
    if (!diagram) return;
    energized = computeEnergized();
    const parts = [];

    // 0) 도면 밑그림 — 가져온 전기도면을 깔고 그 위를 따라 그린다
    const u = diagram.underlay;
    if (u && u.dataUrl && u.visible !== false) {
      parts.push(`<image class="underlay" href="${u.dataUrl}" x="${u.x}" y="${u.y}"
          width="${u.w}" height="${u.h}" opacity="${u.opacity == null ? 0.45 : u.opacity}"
          preserveAspectRatio="none" />`);
    }

    // 1) 결선 (노드 뒤에 깔린다)
    for (const node of diagram.nodes) {
      const bus = busOf(node);
      const cx = node.x + node.w / 2;
      const liveCls = wireClass(node);

      if (node.kind === 'main') {
        // 수전점 → MOF → 주차단기 → 메인 박스
        const topY = node.y - 128;
        parts.push(`<line class="wire${liveCls}" x1="${cx}" y1="${topY + 18}" x2="${cx}" y2="${node.y}" />`);
        parts.push(Sym.draw('utility', cx, topY, 17));
        parts.push(Sym.mof(cx, topY + 52, 13));
        parts.push(breakerGlyph(node, cx, topY + 88, 13));
      }

      if (bus) {
        parts.push(`<line class="wire${liveCls}" x1="${cx}" y1="${node.y + node.h}" x2="${cx}" y2="${bus.y}" />`);
        parts.push(`<line class="bus${liveCls}" x1="${bus.x1}" y1="${bus.y}" x2="${bus.x2}" y2="${bus.y}" />`);
        // 모선 전압 표기 — 사진의 "6.9kV SWGR-1, 3150A, 40kA BUS" 같은 라벨
        const busLabel = node.voltage != null
          ? (node.voltage >= 1 ? `${node.voltage}kV` : `${Math.round(node.voltage * 1000)}V`) + ' BUS'
          : null;
        if (busLabel) {
          parts.push(`<text class="bus-label" x="${bus.x1}" y="${bus.y - 7}">${esc(busLabel)}</text>`);
        }
        for (const kid of bus.kids) {
          const kx = kid.x + kid.w / 2;
          parts.push(`<line class="wire${wireClass(kid)}" x1="${kx}" y1="${bus.y}" x2="${kx}" y2="${kid.y}" />`);
          parts.push(breakerGlyph(kid, kx, bus.y + (kid.y - bus.y) / 2, 12));
        }
      }
    }

    // 2) 모선 연락(TIE)
    for (const tie of diagram.ties || []) parts.push(tieHtml(tie));

    // 3) 노드 박스
    for (const node of diagram.nodes) parts.push(nodeHtml(node));

    // 4) 표제란 · 범례 (도면 관례상 항상 들어간다)
    if (showFrame) {
      parts.push(titleBlockHtml());
      parts.push(legendHtml());
    }

    const vb = `0 0 ${host.clientWidth || 1000} ${host.clientHeight || 600}`;
    svg.setAttribute('viewBox', vb);
    svg.innerHTML = `<g transform="translate(${tx} ${ty}) scale(${scale})">${parts.join('')}</g>`;
  }

  /**
   * 모선 연락 — 수전 2회선 설비의 필수 요소.
   * 한쪽 수전이 정전되면 연락 차단기를 투입해 반대편에서 전원을 받는다.
   */
  function tieHtml(tie) {
    const a = diagram.nodes.filter((n) => n.id === tie.from)[0];
    const b = diagram.nodes.filter((n) => n.id === tie.to)[0];
    if (!a || !b) return '';
    const off = diagram.layout.BUS_OFFSET || 46;
    const y = Math.max(a.y + a.h, b.y + b.h) + off;
    const left = a.x < b.x ? a : b;
    const right = a.x < b.x ? b : a;
    const x1 = left.x + left.w / 2;
    const x2 = right.x + right.w / 2;
    const mx = (x1 + x2) / 2;
    const open = tie.state === 'open';
    const hot = !open && (isLive(a) || isLive(b));
    const cls = open ? ' is-open' : hot ? ' is-live' : '';
    return `<g class="tie${open ? ' is-off' : ''}" data-tie="${esc(tie.id)}">
        <line class="wire tie-line${cls}" x1="${x1}" y1="${y}" x2="${mx - 16}" y2="${y}" />
        <line class="wire tie-line${cls}" x1="${mx + 16}" y1="${y}" x2="${x2}" y2="${y}" />
        <rect x="${mx - 16}" y="${y - 16}" width="32" height="32" fill="transparent" />
        ${Sym.breaker(mx, y, 13, !open).replace('class="cb ', `class="cb${open ? '' : hot ? ' is-hot' : ' is-cold'} `)}
        <text class="tie-label" x="${mx}" y="${y - 13}" text-anchor="middle">${esc(tie.tag || 'TIE')}</text>
        <title>모선 연락 ${esc(tie.tag || '')} — ${open ? '개방' : '투입'} · 클릭하여 조작</title>
      </g>`;
  }

  function nodeHtml(node) {
    const st = statusOf(node);
    const p = primary(node);
    const cls = [
      'nd',
      `is-${node.kind}`,
      node.id === selectedId ? 'is-selected' : '',
      st === 'alarm' ? 'is-alarm' : '',
      st === 'inactive' ? 'is-inactive' : '',
      st === 'dead' ? 'is-dead' : '',
      tieFrom === node.id ? 'is-tie-src' : '',
      zoneFilter && node.zoneCode !== zoneFilter ? 'is-dimmed' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const L = diagram.layout || {};
    const headH = L.HEAD_H || 40;
    const symCx = node.x + 25;
    const symCy = node.y + Math.min(node.h / 2, headH / 2 + 10);
    const textX = node.x + 46;

    const sub = node.deviceKind
      ? node.deviceKind + (node.facility && node.facility.equipmentCode ? ` · ${node.facility.equipmentCode}` : '')
      : node.facility && node.facility.equipmentCode
        ? node.facility.equipmentCode
        : node.device
          ? `#${node.device.deviceId}/CH${node.channel}`
          : Sym.LABELS[node.symbol] || '';

    // ── 계측값 격자 ─────────────────────────────────────────────
    // 기본은 유효전력량·전류·전압·역률 4종(2열 2행). "표시 항목" 메뉴에서
    // 늘리면 줄 수만큼 박스가 높아진다.
    const items = displayItems();
    const cols = L.VAL_COLS || 2;
    const rowH = L.VAL_ROW_H || 15;
    const gridX = node.x + 8;
    const gridW = node.w - 16;
    const cellW = gridW / cols;
    let valueLine = '';
    if (!node.points || !node.points.length) {
      valueLine = `<text class="nd-sub" x="${textX}" y="${node.y + headH + 11}" text-anchor="start">계측 미연결</text>`;
    } else {
      valueLine = items
        .map((item, i) => {
          const cx0 = gridX + (i % cols) * cellW;
          const cy = node.y + headH + Math.floor(i / cols) * rowH + 11;
          const v = valueOf(node, item);
          const stale = !v.reading || v.reading.stale;
          const shown = stale ? { value: null, unit: v.unit } : scaleValue(v.reading.value, v.unit);
          const num = !v.linked ? '·' : stale ? '--' : fmt(shown.value);
          const unit = shown.unit ? ` ${shown.unit}` : '';
          return (
            `<text class="nd-vk" x="${cx0}" y="${cy}">${esc(item.short || item.label)}</text>` +
            `<text class="nd-val${stale ? ' is-stale' : ''}" x="${cx0 + cellW - 9}" y="${cy}" text-anchor="end">${esc(num)}<tspan class="nd-vu">${esc(unit)}</tspan></text>`
          );
        })
        .join('');
    }

    // ── v2 표기 ────────────────────────────────────────────────
    // 정격은 박스 위 작은 태그로, 보호요소는 박스 아래 칩으로 붙인다.
    // 실제 관제화면에서 차단기 옆에 "24kV 1250A 25kA" 와 50/51 박스가
    // 따로 붙어 있는 배치를 그대로 따랐다.
    let extras = '';
    if (node.tag) {
      extras += `<text class="nd-tag" x="${node.x}" y="${node.y - 5}">${esc(node.tag)}</text>`;
    }
    if (node.rating) {
      const tw = node.rating.length * 5.4 + 10;
      extras += `
        <rect class="rating-bg" x="${node.x + node.w - tw}" y="${node.y - 15}" width="${tw}" height="13" rx="2" />
        <text class="rating-tx" x="${node.x + node.w - tw / 2}" y="${node.y - 5}" text-anchor="middle">${esc(node.rating)}</text>`;
    }
    if (node.protection && node.protection.length) {
      let px = node.x;
      for (const code of node.protection.slice(0, 5)) {
        const cw = code.length * 5.2 + 8;
        extras += `
          <rect class="prot-bg" x="${px}" y="${node.y + node.h + 4}" width="${cw}" height="12" rx="1.5" />
          <text class="prot-tx" x="${px + cw / 2}" y="${node.y + node.h + 13}" text-anchor="middle">${esc(code)}</text>`;
        px += cw + 3;
      }
    }
    // 중성점 접지 — 변압기·NGR 관례대로 박스 왼쪽 아래에 붙인다
    if (node.grounded) {
      const gy = node.y + node.h - 8;
      extras += `<line class="nd-sym" x1="${node.x}" y1="${gy}" x2="${node.x - 13}" y2="${gy}" />`;
      extras += Sym.ground(node.x - 13, gy + 3, 13);
    }
    // 변압기는 제원을 박스 오른쪽에 두 줄로 붙인다
    if (node.transformer && node.transformer.label) {
      const L = node.transformer.label;
      if (L.line1) extras += `<text class="tr-spec" x="${node.x + node.w + 7}" y="${node.y + 24}">${esc(L.line1)}</text>`;
      if (L.line2) extras += `<text class="tr-spec dim" x="${node.x + node.w + 7}" y="${node.y + 36}">${esc(L.line2)}</text>`;
    }

    const tip = [
      node.name,
      node.deviceKind ? `종류 ${node.deviceKind}` : null,
      node.rating || null,
      node.protection && node.protection.length ? `보호 ${node.protection.join(', ')}` : null,
      node.zoneName ? `구역 ${node.zoneName}` : null,
      node.device ? `${node.device.productName || ''} (${node.device.ip || ''})` : null,
    ].filter(Boolean).join(' · ');

    return `
      <g class="${cls}" data-id="${esc(node.id)}" role="button" tabindex="0" aria-label="${esc(node.name)}">
        ${extras}
        <rect class="nd-box" x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" />
        ${Sym.draw(node.symbol, symCx, symCy, 13)}
        <text class="nd-name" x="${textX}" y="${node.y + 21}" text-anchor="start">${esc(clip(node.name, 11))}</text>
        <text class="nd-sub" x="${textX}" y="${node.y + 34}" text-anchor="start">${esc(clip(sub, 15))}</text>
        ${valueLine}
        ${st === 'dead'
          ? `<rect class="dead-bg" x="${node.x + node.w - 36}" y="${node.y + 12}" width="32" height="13" rx="2" />
             <text class="dead-tx" x="${node.x + node.w - 20}" y="${node.y + 22}" text-anchor="middle">정전</text>`
          : ''}
        <title>${esc(tip)}</title>
      </g>`;
  }

  // ── 표제란 · 범례 ──────────────────────────────────────────────
  /** 노드만으로 계산한 도면 영역 (표제란 위치의 기준) */
  function nodeBounds() {
    if (!diagram.nodes.length) return { x1: 0, y1: 0, x2: 800, y2: 600 };
    return {
      x1: Math.min(...diagram.nodes.map((n) => n.x)),
      y1: Math.min(...diagram.nodes.map((n) => n.y)),
      x2: Math.max(...diagram.nodes.map((n) => n.x + n.w)),
      y2: Math.max(...diagram.nodes.map((n) => n.y + n.h)),
    };
  }

  const TB = { w: 330, h: 76 };

  function titleBlockBox() {
    const b = nodeBounds();
    return { x: b.x2 - TB.w, y: b.y2 + 62, w: TB.w, h: TB.h };
  }

  /** 도면 표제란 — 도면번호·개정·작성일. 종이로 뽑았을 때 필요한 최소 항목. */
  function titleBlockHtml() {
    const t = diagram.titleBlock || {};
    const box = titleBlockBox();
    const rows = [
      ['도면번호', t.drawingNo || '-'],
      ['개정', t.revision || '-'],
      ['작성', t.drawnBy || '-'],
      ['일자', t.date || '-'],
    ];
    let cells = '';
    rows.forEach(([k, v], i) => {
      const cw = box.w / 4;
      const cxp = box.x + i * cw;
      cells += `<line class="tb-line" x1="${cxp}" y1="${box.y + 38}" x2="${cxp}" y2="${box.y + box.h}" />
        <text class="tb-k" x="${cxp + 6}" y="${box.y + 52}">${esc(k)}</text>
        <text class="tb-v" x="${cxp + 6}" y="${box.y + 67}">${esc(v)}</text>`;
    });
    return `<g class="title-block">
        <rect class="tb-bg" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" />
        <text class="tb-title" x="${box.x + 8}" y="${box.y + 19}">${esc(t.title || diagram.meta.name || '단선결선도')}</text>
        <text class="tb-sub" x="${box.x + 8}" y="${box.y + 32}">${esc(t.company || diagram.meta.company || '')}</text>
        <line class="tb-line" x1="${box.x}" y1="${box.y + 38}" x2="${box.x + box.w}" y2="${box.y + 38}" />
        ${cells}
      </g>`;
  }

  /**
   * 심볼 범례 — 이 도면에 실제로 쓰인 심볼만 모아 보여 준다.
   * 도면을 받은 사람이 기호를 물어보지 않게 하는 것이 목적이다.
   */
  function legendHtml() {
    const used = [];
    for (const n of diagram.nodes) if (used.indexOf(n.symbol) < 0) used.push(n.symbol);
    const items = used.map((id) => ({ id, label: (Sym.byId(id) && Sym.byId(id).label) || Sym.LABELS[id] || id }));
    const cols = Math.min(3, Math.max(1, Math.ceil(items.length / 6)));
    const rows = Math.ceil(items.length / cols);
    const colW = 132;
    const rowH = 21;
    const b = nodeBounds();
    const x = b.x1;
    const y = b.y2 + 62;
    const w = cols * colW + 12;
    const h = rows * rowH + 46;

    let body = '';
    items.forEach((it, i) => {
      const cxp = x + 8 + Math.floor(i / rows) * colW + 13;
      const cyp = y + 40 + (i % rows) * rowH;
      body += Sym.draw(it.id, cxp, cyp, 8) +
        `<text class="lg-tx" x="${cxp + 16}" y="${cyp + 3.5}">${esc(it.label)}</text>`;
    });

    // 결선 상태 범례 — 색이 무엇을 뜻하는지 도면 안에 적어 둔다
    const sy = y + h - 14;
    const stateLegend =
      `<line class="wire is-live" x1="${x + 10}" y1="${sy}" x2="${x + 30}" y2="${sy}" />
       <text class="lg-tx" x="${x + 34}" y="${sy + 3.5}">가압</text>
       <line class="wire" x1="${x + 74}" y1="${sy}" x2="${x + 94}" y2="${sy}" />
       <text class="lg-tx" x="${x + 98}" y="${sy + 3.5}">정전</text>
       ${Sym.breaker(x + 142, sy, 11, true)}
       <text class="lg-tx" x="${x + 152}" y="${sy + 3.5}">투입</text>
       ${Sym.breaker(x + 192, sy, 11, false)}
       <text class="lg-tx" x="${x + 202}" y="${sy + 3.5}">개방</text>`;

    return `<g class="legend-block">
        <rect class="tb-bg" x="${x}" y="${y}" width="${Math.max(w, 250)}" height="${h}" />
        <text class="tb-title" x="${x + 8}" y="${y + 19}">범례 · LEGEND</text>
        <line class="tb-line" x1="${x}" y1="${y + 26}" x2="${x + Math.max(w, 250)}" y2="${y + 26}" />
        ${body}
        ${stateLegend}
      </g>`;
  }

  // ── 도면 편집 (엑셀 없이 그리기) ───────────────────────────────
  function nextSystemId() {
    return Math.max(0, ...diagram.nodes.map((n) => n.systemId || 0)) + 1;
  }

  /**
   * 팔레트에서 고른 심볼을 도면에 넣는다.
   * 상위를 지정하면 그 아래 분기로, 없으면 새 수전 계통(루트)으로 붙는다.
   */
  function addNode(symbolId, parentId, opts) {
    if (!diagram) return null;
    const spec = Sym.byId(symbolId) || { id: symbolId, label: symbolId, name: symbolId };
    const parent = parentId ? diagram.nodes.filter((n) => n.id === parentId)[0] : null;
    const L = diagram.layout;
    const id = `n${nextSystemId()}`;
    const sysId = nextSystemId();

    let x;
    let y;
    let depth;
    if (opts && opts.x != null && opts.y != null) {
      // 트레이싱 — 클릭한 자리에 그대로 놓는다
      depth = parent ? (parent.depth || 1) + 1 : 1;
      x = Math.round(opts.x - L.NODE_W / 2);
      y = Math.round(opts.y - L.NODE_H / 2);
    } else if (parent) {
      depth = (parent.depth || 1) + 1;
      y = L.LANE_TOP + (depth - 1) * L.LANE_H;
      const sibs = diagram.nodes.filter((n) => n.parent === parent.id);
      x = sibs.length
        ? Math.max(...sibs.map((n) => n.x)) + L.LEAF_W
        : Math.round(parent.x + parent.w / 2 - L.NODE_W / 2);
    } else {
      depth = 1;
      y = L.LANE_TOP;
      x = diagram.nodes.length ? Math.max(...diagram.nodes.map((n) => n.x + n.w)) + L.MAIN_GAP : L.PAD_X;
    }

    const node = {
      id,
      systemId: sysId,
      mainId: parent ? parent.mainId || parent.id : id,
      kind: parent ? 'load' : 'main',
      symbol: spec.id,
      name: (opts && opts.name) || spec.name || spec.label,
      depth,
      x: Math.round(x),
      y,
      w: L.NODE_W,
      h: L.NODE_H,
      parent: parent ? parent.id : null,
      energySource: parent ? parent.energySource : 1,
      energySourceName: parent ? parent.energySourceName : '전력',
      device: null,
      channel: null,
      facility: null,
      ratedPower: null,
      capacity: null,
      deviceKind: spec.kind || null,
      voltage: parent && parent.voltage != null ? parent.voltage : null,
      rating: null,
      ratedCurrent: null,
      breakingCapacity: null,
      protection: [],
      zoneCode: parent ? parent.zoneCode : null,
      zoneName: parent ? parent.zoneName : null,
      tag: null,
      transformer: null,
      incomer: null,
      points: [],
      display: {},
      breakerState: 'closed',
      grounded: spec.kind === 'TR' || spec.kind === 'NGR' || spec.kind === 'GND',
      locked: false,
      source: 'manual',
    };

    // 부모가 말단이었다면 분기 계통으로 승격 (모선이 생긴다)
    if (parent && parent.kind === 'load') parent.kind = 'group';
    diagram.nodes.push(node);
    refreshRating(node);
    render();
    select(node.id);
    onChange();
    return node;
  }

  /** 클릭한 자리 위쪽에서 가장 가까운 노드 — 트레이싱 시 상위 계통 추정 */
  function nearestAbove(x, y) {
    let best = null;
    let bd = Infinity;
    for (const n of diagram.nodes) {
      if (n.y + n.h > y) continue; // 아래쪽 노드는 상위가 될 수 없다
      const d = Math.abs(n.x + n.w / 2 - x) + (y - (n.y + n.h)) * 0.6;
      if (d < bd) { bd = d; best = n; }
    }
    return best ? best.id : null;
  }

  /** 정격 표기 문자열 다시 만들기 — 서버 diagram.ratingLabel() 과 같은 규칙 */
  function refreshRating(node) {
    const parts = [];
    if (node.voltage != null) parts.push(node.voltage >= 1 ? `${node.voltage}kV` : `${Math.round(node.voltage * 1000)}V`);
    if (node.ratedCurrent != null) parts.push(`${node.ratedCurrent}A`);
    if (node.breakingCapacity != null) parts.push(`${node.breakingCapacity}kA`);
    node.rating = parts.join(' ') || null;
    return node.rating;
  }

  /** 상위 계통 변경 — 순환은 막는다 */
  function setParent(nodeId, parentId) {
    const node = diagram.nodes.filter((n) => n.id === nodeId)[0];
    if (!node) return false;
    if (parentId) {
      let cur = diagram.nodes.filter((n) => n.id === parentId)[0];
      while (cur) {
        if (cur.id === nodeId) return false; // 자기 자손을 상위로 지정할 수 없다
        cur = cur.parent ? diagram.nodes.filter((n) => n.id === cur.parent)[0] : null;
      }
    }
    const before = node.parent;
    node.parent = parentId || null;
    node.kind = parentId ? (childrenOf(node.id).length ? 'group' : 'load') : 'main';
    // 옛 부모가 말단이 되었으면 되돌린다
    const old = diagram.nodes.filter((n) => n.id === before)[0];
    if (old && old.kind === 'group' && !childrenOf(old.id).length) old.kind = 'load';
    const np = diagram.nodes.filter((n) => n.id === parentId)[0];
    if (np && np.kind === 'load') np.kind = 'group';
    autoLayout();
    return true;
  }

  /** 차단기 조작 */
  function toggleBreaker(nodeId) {
    const node = diagram.nodes.filter((n) => n.id === nodeId)[0];
    if (!node) return null;
    node.breakerState = node.breakerState === 'open' ? 'closed' : 'open';
    render();
    onChange();
    return node.breakerState;
  }

  /** 모선 연락 추가 · 조작 · 삭제 */
  function addTie(fromId, toId, tag) {
    if (!diagram || fromId === toId) return null;
    diagram.ties = diagram.ties || [];
    const dup = diagram.ties.filter(
      (t) => (t.from === fromId && t.to === toId) || (t.from === toId && t.to === fromId)
    )[0];
    if (dup) return dup;
    const tie = {
      id: `t${diagram.ties.length + 1}-${Date.now().toString(36)}`,
      from: fromId,
      to: toId,
      state: 'open', // 연락은 평소 개방이 관례다
      tag: tag || `TIE-${diagram.ties.length + 1}`,
    };
    diagram.ties.push(tie);
    render();
    onChange();
    return tie;
  }

  function toggleTie(tieId) {
    const t = (diagram.ties || []).filter((x) => x.id === tieId)[0];
    if (!t) return null;
    t.state = t.state === 'open' ? 'closed' : 'open';
    render();
    onChange();
    return t.state;
  }

  function removeTie(tieId) {
    diagram.ties = (diagram.ties || []).filter((t) => t.id !== tieId);
    render();
    onChange();
  }

  /** 연락 연결 모드 — 시작 노드를 잡아 두고 다음 클릭에서 잇는다 */
  function startTie(nodeId) {
    tieFrom = nodeId || null;
    render();
    return tieFrom;
  }

  // ── 상호작용 ───────────────────────────────────────────────────
  function toWorld(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return { x: (clientX - r.left - tx) / scale, y: (clientY - r.top - ty) / scale };
  }

  function attach() {
    let dragNode = null;
    let dragOff = { x: 0, y: 0 };
    let panning = null;
    let moved = false;

    host.addEventListener('mousedown', (e) => {
      moved = false;

      // 차단기·연락 글리프 클릭은 "조작" 이다 (선택/이동보다 우선)
      const cb = e.target.closest && e.target.closest('[data-cb]');
      if (cb) {
        e.preventDefault();
        toggleBreaker(cb.dataset.cb);
        return;
      }
      const tie = e.target.closest && e.target.closest('[data-tie]');
      if (tie) {
        e.preventDefault();
        toggleTie(tie.dataset.tie);
        return;
      }

      // 트레이싱 펜 — 빈 곳을 클릭하면 그 자리에 심볼을 놓는다
      if (pen && !(e.target.closest && e.target.closest('.nd'))) {
        e.preventDefault();
        const w = toWorld(e.clientX, e.clientY);
        const parent = selectedId ? selectedId : nearestAbove(w.x, w.y);
        addNode(pen, parent, { x: w.x, y: w.y });
        return;
      }

      const g = e.target.closest && e.target.closest('.nd');
      if (g) {
        const node = diagram.nodes.find((n) => n.id === g.dataset.id);
        if (!node) return;
        // 연락 연결 대기 중이면 두 번째 클릭에서 잇는다
        if (tieFrom && tieFrom !== node.id) {
          addTie(tieFrom, node.id);
          tieFrom = null;
          render();
          return;
        }
        select(node.id);
        if (node.locked) return;
        const w = toWorld(e.clientX, e.clientY);
        dragNode = node;
        dragOff = { x: w.x - node.x, y: w.y - node.y };
        e.preventDefault();
      } else {
        panning = { x: e.clientX - tx, y: e.clientY - ty };
        host.classList.add('is-panning');
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (dragNode) {
        const w = toWorld(e.clientX, e.clientY);
        const nx = Math.round((w.x - dragOff.x) / 4) * 4;
        const ny = Math.round((w.y - dragOff.y) / 4) * 4;
        if (nx !== dragNode.x || ny !== dragNode.y) moved = true;
        dragNode.x = nx;
        dragNode.y = ny;
        render();
      } else if (panning) {
        tx = e.clientX - panning.x;
        ty = e.clientY - panning.y;
        moved = true;
        render();
      }
    });

    window.addEventListener('mouseup', () => {
      if (dragNode && moved) onChange();
      dragNode = null;
      panning = null;
      host.classList.remove('is-panning');
    });

    host.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const next = Math.min(2.4, Math.max(0.18, scale * factor));
        tx = mx - ((mx - tx) * next) / scale;
        ty = my - ((my - ty) * next) / scale;
        scale = next;
        render();
        emitZoom();
      },
      { passive: false }
    );

    host.addEventListener('keydown', (e) => {
      if (!selectedId) return;
      const node = diagram.nodes.find((n) => n.id === selectedId);
      if (!node) return;
      const step = e.shiftKey ? 20 : 4;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key]) {
        node.x += map[e.key][0];
        node.y += map[e.key][1];
        render();
        onChange();
        e.preventDefault();
      }
    });
  }

  function emitZoom() {
    const el = document.getElementById('zoomLabel');
    if (el) el.textContent = `${Math.round(scale * 100)}%`;
  }

  function select(id) {
    selectedId = id;
    render();
    onSelect(diagram.nodes.find((n) => n.id === id) || null);
  }

  // ── 뷰 조작 ────────────────────────────────────────────────────
  function bounds() {
    if (!diagram.nodes.length) return { x1: 0, y1: 0, x2: 800, y2: 600 };
    const b = nodeBounds();
    // 표제란·범례가 아래에 붙으므로 그 높이를 함께 잡는다
    const frameH = showFrame ? 62 + Math.max(TB.h, 190) : 80;
    return {
      x1: b.x1 - 70,
      y1: b.y1 - 165, // 수전 심볼 자리
      x2: b.x2 + 70,
      y2: b.y2 + frameH,
    };
  }

  function fit() {
    const b = bounds();
    const cw = host.clientWidth || 1000;
    const ch = host.clientHeight || 600;
    scale = Math.min(2, Math.max(0.15, Math.min(cw / (b.x2 - b.x1), ch / (b.y2 - b.y1))));
    tx = (cw - (b.x2 - b.x1) * scale) / 2 - b.x1 * scale;
    ty = (ch - (b.y2 - b.y1) * scale) / 2 - b.y1 * scale;
    render();
    emitZoom();
  }

  function zoomBy(f) {
    const cw = (host.clientWidth || 1000) / 2;
    const ch = (host.clientHeight || 600) / 2;
    const next = Math.min(2.4, Math.max(0.18, scale * f));
    tx = cw - ((cw - tx) * next) / scale;
    ty = ch - ((ch - ty) * next) / scale;
    scale = next;
    render();
    emitZoom();
  }

  /**
   * 자동 정렬 — 서버의 최초 배치와 동일한 규칙(leaf 슬롯 기반 tidy layout)을
   * 클라이언트에서 다시 적용한다. 사용자가 흐트러뜨린 도면을 되돌리는 용도.
   */
  function autoLayout() {
    const L = diagram.layout;
    const roots = diagram.nodes.filter((n) => !n.parent);
    const kidsOf = new Map();
    for (const n of diagram.nodes) {
      if (!n.parent) continue;
      if (!kidsOf.has(n.parent)) kidsOf.set(n.parent, []);
      kidsOf.get(n.parent).push(n);
    }
    for (const list of kidsOf.values()) list.sort((a, b) => (a.systemId || 0) - (b.systemId || 0));

    function place(node, x0, depth) {
      const kids = kidsOf.get(node.id) || [];
      node.depth = depth;
      node.y = L.LANE_TOP + (depth - 1) * L.LANE_H;
      if (!kids.length) {
        node.x = Math.round(x0 + L.LEAF_W / 2 - node.w / 2);
        return L.LEAF_W;
      }
      let cursor = x0;
      let total = 0;
      for (const k of kids) {
        const w = place(k, cursor, depth + 1);
        cursor += w;
        total += w;
      }
      node.x = Math.round(x0 + total / 2 - node.w / 2);
      return total;
    }

    let cursor = L.PAD_X;
    for (const r of roots) {
      cursor += place(r, cursor, 1) + L.MAIN_GAP;
    }
    render();
    onChange();
    fit();
  }

  // ── 내보내기 ───────────────────────────────────────────────────
  /** 외부에서 열어도 동일하게 보이도록 필요한 스타일을 파일 안에 심는다. */
  const EXPORT_STYLE = `
    .nd-box{fill:#14203a;stroke:#2c3f6d;stroke-width:1.5;rx:6}
    .nd.is-main .nd-box{fill:#1b2740;stroke:#d9a441}
    .nd.is-inactive{opacity:.48}
    .nd-name{fill:#eef3fb;font-size:11.5px;font-weight:600}
    .nd-sub{fill:#6d80a6;font-size:9.5px}
    .nd-val{fill:#35d0a5;font-size:9.6px;font-weight:700}
    .nd-val.is-stale{fill:#5b6b8c}
    .nd-vk{fill:#7488ad;font-size:8px}
    .nd-vu{fill:#7fb9a4;font-size:7.6px;font-weight:400}
    .nd-val.is-stale .nd-vu{fill:#4d5c79}
    .nd-sym{fill:none;stroke:#8fa6d4;stroke-width:1.6}
    .nd.is-main .nd-sym{stroke:#ffd479}
    .nd-sym-fill{fill:#8fa6d4}
    .wire{stroke:#46577c;stroke-width:2;fill:none}
    .wire.is-live{stroke:#35d0a5}
    .wire.is-alarm{stroke:#e5484d}
    .bus{stroke:#46577c;stroke-width:5;stroke-linecap:round}
    .bus.is-live{stroke:#35d0a5}
    .cb{fill:#0a1020;stroke:#46577c;stroke-width:1.8}
    .cb.is-closed{fill:#35d0a5;stroke:#35d0a5}
    .cb.is-open{fill:#0a1020;stroke:#c98500}
    .cb.is-closed.is-cold{fill:#46577c;stroke:#46577c}
    .wire.is-on{stroke:#2b7f68}
    .bus.is-on{stroke:#2b7f68}
    .nd.is-dead .nd-box{stroke:#2c3f6d}
    .nd.is-dead .nd-name{fill:#8d9cba}
    .nd.is-dead .nd-sym{stroke:#5d6d8f}
    .nd.is-dead .nd-box{fill:#0f1626}
    .nd.is-dead .nd-val{fill:#5b6b8c}
    .nd.is-dead .nd-vu{fill:#4d5c79}
    .dead-bg{fill:rgba(109,128,166,.18)}
    .dead-tx{fill:#9fb0cf;font-size:8px;font-weight:600}
    .tie-line{stroke-dasharray:6 4}
    .tie-line.is-live{stroke:#35d0a5;stroke-dasharray:none}
    .tie-label{fill:#b9d4ff;font-size:9px;font-weight:600}
    .tb-bg{fill:rgba(17,26,46,.92);stroke:#24345c;stroke-width:1}
    .tb-line{stroke:#24345c;stroke-width:1}
    .tb-title{fill:#eef3fb;font-size:12px;font-weight:700}
    .tb-sub{fill:#6d80a6;font-size:9.5px}
    .tb-k{fill:#6d80a6;font-size:8.5px}
    .tb-v{fill:#a8b8d6;font-size:10px;font-weight:600}
    .lg-tx{fill:#a8b8d6;font-size:9.5px}
    .rating-bg{fill:rgba(217,164,65,.13);stroke:rgba(217,164,65,.45);stroke-width:.8}
    .rating-tx{fill:#e7c07a;font-size:8.5px;font-weight:600}
    .prot-bg{fill:rgba(57,135,229,.16);stroke:rgba(57,135,229,.5);stroke-width:.8}
    .prot-tx{fill:#9cc4f5;font-size:8px;font-weight:700}
    .tr-spec{fill:#c9d6ee;font-size:9px;font-weight:600}
    .tr-spec.dim{fill:#6d80a6;font-weight:400}
    .bus-label{fill:#6d80a6;font-size:9.5px}
    .nd-tag{fill:#b9d4ff;font-size:8.5px}
    .nd.is-dimmed{opacity:.28}
    text{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif}
  `;

  function toSvgString(opts) {
    const b = bounds();
    const w = Math.round(b.x2 - b.x1);
    const h = Math.round(b.y2 - b.y1);
    // PDF 는 자체 표제란(A3 도면틀)을 그리므로 중복을 뺀다
    const g = svg.querySelector('g').cloneNode(true);
    // 밑그림은 따라 그리기용 보조물 — 완성 도면에는 넣지 않는다
    const ul = g.querySelector('.underlay');
    if (ul) ul.parentNode.removeChild(ul);
    if (opts && opts.titleBlock === false) {
      const tb = g.querySelector('.title-block');
      if (tb) tb.parentNode.removeChild(tb);
    }
    const inner = g.innerHTML;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${b.x1} ${b.y1} ${w} ${h}">
  <style>${EXPORT_STYLE}</style>
  <rect x="${b.x1}" y="${b.y1}" width="${w}" height="${h}" fill="#0a1020"/>
  ${inner}
</svg>`;
  }

  // ── 공개 API ───────────────────────────────────────────────────
  function init(opts) {
    host = opts.host;
    svg = opts.svg;
    onChange = opts.onChange || (() => {});
    onSelect = opts.onSelect || (() => {});
    attach();
    window.addEventListener('resize', () => render());
  }

  function setDiagram(d) {
    diagram = d;
    selectedId = null;
    tieFrom = null;
    setPen(null);
    // 이전 버전 도면 호환 — 없는 필드를 기본값으로 채운다
    if (diagram) {
      if (!diagram.ties) diagram.ties = [];
      for (const n of diagram.nodes) {
        if (!n.breakerState) n.breakerState = 'closed';
        if (n.grounded == null) n.grounded = false;
      }
    }
    render();
    fit();
  }

  function setLive(l) {
    live = l || { values: {} };
    render();
  }

  /**
   * 표시 항목 변경 — 서버 diagram.applyDisplayItems() 와 같은 규칙으로
   * 박스 높이·레인 간격을 다시 잡는다. 줄 수가 그대로면 배치는 건드리지 않는다.
   */
  function setDisplayItems(ids) {
    if (!diagram) return [];
    const wanted = (ids || []).filter((id) => measureById(id));
    diagram.displayItems = wanted.length ? wanted : catalog().filter((m) => m.default).map((m) => m.id);

    const L = diagram.layout;
    const h = heightFor(diagram.displayItems.length);
    if (h !== L.NODE_H) {
      const lane = Math.max(205, h + 127);
      const top = L.LANE_TOP;
      let maxDepth = 1;
      for (const n of diagram.nodes) {
        n.h = h;
        n.y = top + ((n.depth || 1) - 1) * lane;
        maxDepth = Math.max(maxDepth, n.depth || 1);
      }
      L.NODE_H = h;
      L.LANE_H = lane;
      L.maxDepth = maxDepth;
      L.canvasH = top + maxDepth * lane + (L.PAD_BOTTOM || 120);
      render();
      fit();
    } else {
      render();
    }
    return diagram.displayItems;
  }

  // ── 도면 밑그림 (트레이싱) ─────────────────────────────────────
  /**
   * 가져온 전기도면을 캔버스에 깔아 준다.
   * 스캔 도면은 글자를 꺼낼 수 없으므로, 이 밑그림 위를 심볼 메뉴바로
   * 따라 그리는 것이 가장 빠르고 정확하다.
   */
  function setUnderlay(u) {
    if (!diagram) return null;
    if (!u) {
      delete diagram.underlay;
      render();
      fit();
      return null;
    }
    // 도면 폭에 맞춰 적당한 크기로 앉힌다
    const targetW = Math.max(1400, diagram.layout.canvasW || 1400);
    const scaleTo = targetW / (u.w || targetW);
    diagram.underlay = {
      dataUrl: u.dataUrl,
      x: 0,
      y: 40,
      w: Math.round((u.w || targetW) * scaleTo),
      h: Math.round((u.h || 900) * scaleTo),
      opacity: 0.45,
      visible: true,
      name: u.name || '',
    };
    render();
    fit();
    onChange();
    return diagram.underlay;
  }

  function updateUnderlay(patch) {
    if (!diagram || !diagram.underlay) return null;
    Object.assign(diagram.underlay, patch);
    render();
    onChange();
    return diagram.underlay;
  }

  /** 밑그림 크기 조절 — 비율은 유지한다 */
  function scaleUnderlay(factor) {
    const u = diagram && diagram.underlay;
    if (!u) return null;
    const ratio = u.h / u.w;
    u.w = Math.round(u.w * factor);
    u.h = Math.round(u.w * ratio);
    render();
    onChange();
    return u;
  }

  /**
   * 트레이싱 펜 — 심볼을 하나 잡고 도면 위를 클릭하면 그 자리에 놓인다.
   * 연달아 클릭해 여러 개를 빠르게 찍을 수 있고, Esc 로 내려놓는다.
   */
  function setPen(symbolId) {
    pen = symbolId || null;
    host.classList.toggle('is-pen', !!pen);
    return pen;
  }

  /** 표제란·범례 표시 토글 */
  function setFrame(on) {
    showFrame = !!on;
    render();
    fit();
    return showFrame;
  }

  /** 구역 필터 — 선택 구역 외 설비는 흐리게 (계통 전체 맥락은 유지) */
  function setZone(code) {
    zoneFilter = code || '';
    render();
  }

  return {
    init,
    setDiagram,
    setLive,
    render,
    fit,
    zoomBy,
    autoLayout,
    select,
    setZone,
    setDisplayItems,
    displayItems,
    catalog,
    measure: measureById,
    scaleValue,
    addNode,
    setParent,
    refreshRating,
    toggleBreaker,
    addTie,
    toggleTie,
    removeTie,
    startTie,
    setFrame,
    setUnderlay,
    updateUnderlay,
    scaleUnderlay,
    setPen,
    toSvgString,
    statusOf,
    primary,
    reading,
    get selectedId() {
      return selectedId;
    },
    get diagram() {
      return diagram;
    },
    get live() {
      return live;
    },
    get tieFrom() {
      return tieFrom;
    },
    get pen() {
      return pen;
    },
    get underlay() {
      return diagram && diagram.underlay ? diagram.underlay : null;
    },
    get energized() {
      return energized;
    },
  };
})();
