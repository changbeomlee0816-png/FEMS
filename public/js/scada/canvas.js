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

  // ── 값 조회 ────────────────────────────────────────────────────
  function reading(key) {
    if (!key) return null;
    const r = live.values && live.values[key];
    if (!r || r.value == null) return null;
    const ts = r.ts ? new Date(r.ts.replace(' ', 'T') + (r.ts.endsWith('Z') ? '' : 'Z')).getTime() : 0;
    return { value: r.value, ts, stale: !ts || Date.now() - ts > STALE_MS };
  }

  /** 노드의 대표 표시값 (유효전력 우선) */
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

  /** 노드 상태 — 색상은 상태에만 쓰고, 항상 텍스트와 함께 표시한다. */
  function statusOf(node) {
    if (node.device && node.device.active === false) return 'inactive';
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

  // ── 렌더링 ─────────────────────────────────────────────────────
  function render() {
    if (!diagram) return;
    const parts = [];

    // 1) 결선 (노드 뒤에 깔린다)
    for (const node of diagram.nodes) {
      const bus = busOf(node);
      const cx = node.x + node.w / 2;
      const st = statusOf(node);
      const liveCls = st === 'live' || st === 'warn' ? ' is-live' : st === 'alarm' ? ' is-alarm' : '';

      if (node.kind === 'main') {
        // 수전점 → MOF → 주차단기 → 메인 박스
        const topY = node.y - 128;
        parts.push(`<line class="wire${liveCls}" x1="${cx}" y1="${topY + 18}" x2="${cx}" y2="${node.y}" />`);
        parts.push(Sym.draw('utility', cx, topY, 17));
        parts.push(Sym.mof(cx, topY + 52, 13));
        parts.push(Sym.breaker(cx, topY + 88, 13, st !== 'inactive'));
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
          const kst = statusOf(kid);
          const kcls = kst === 'live' || kst === 'warn' ? ' is-live' : kst === 'alarm' ? ' is-alarm' : '';
          parts.push(`<line class="wire${kcls}" x1="${kx}" y1="${bus.y}" x2="${kx}" y2="${kid.y}" />`);
          parts.push(Sym.breaker(kx, bus.y + (kid.y - bus.y) / 2, 12, kst !== 'inactive'));
        }
      }
    }

    // 2) 노드 박스
    for (const node of diagram.nodes) parts.push(nodeHtml(node));

    const vb = `0 0 ${host.clientWidth || 1000} ${host.clientHeight || 600}`;
    svg.setAttribute('viewBox', vb);
    svg.innerHTML = `<g transform="translate(${tx} ${ty}) scale(${scale})">${parts.join('')}</g>`;
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
      zoneFilter && node.zoneCode !== zoneFilter ? 'is-dimmed' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const symCx = node.x + 25;
    const symCy = node.y + node.h / 2;
    const textX = node.x + 46;

    const sub = node.deviceKind
      ? node.deviceKind + (node.facility && node.facility.equipmentCode ? ` · ${node.facility.equipmentCode}` : '')
      : node.facility && node.facility.equipmentCode
        ? node.facility.equipmentCode
        : node.device
          ? `#${node.device.deviceId}/CH${node.channel}`
          : Sym.LABELS[node.symbol] || '';

    let valueLine = '';
    if (p) {
      const stale = !p.reading || p.reading.stale;
      const text = stale ? '-- ' + (p.unit || '') : `${fmt(p.reading.value)} ${p.unit || ''}`;
      valueLine = `<text class="nd-val${stale ? ' is-stale' : ''}" x="${textX}" y="${node.y + 50}" text-anchor="start">${esc(text)}</text>`;
    } else {
      valueLine = `<text class="nd-sub" x="${textX}" y="${node.y + 50}" text-anchor="start">계측 미연결</text>`;
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
        <text class="nd-name" x="${textX}" y="${node.y + 21}" text-anchor="start">${esc(clip(node.name, 9))}</text>
        <text class="nd-sub" x="${textX}" y="${node.y + 34}" text-anchor="start">${esc(clip(sub, 13))}</text>
        ${valueLine}
        <title>${esc(tip)}</title>
      </g>`;
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
      const g = e.target.closest && e.target.closest('.nd');
      moved = false;
      if (g) {
        const node = diagram.nodes.find((n) => n.id === g.dataset.id);
        if (!node) return;
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
    const xs = diagram.nodes.map((n) => n.x);
    const ys = diagram.nodes.map((n) => n.y);
    return {
      x1: Math.min(...xs) - 70,
      y1: Math.min(...ys) - 165, // 수전 심볼 자리
      x2: Math.max(...diagram.nodes.map((n) => n.x + n.w)) + 70,
      y2: Math.max(...diagram.nodes.map((n) => n.y + n.h)) + 80,
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
    .nd-val{fill:#35d0a5;font-size:10.5px;font-weight:700}
    .nd-val.is-stale{fill:#5b6b8c}
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

  function toSvgString() {
    const b = bounds();
    const w = Math.round(b.x2 - b.x1);
    const h = Math.round(b.y2 - b.y1);
    const inner = svg.querySelector('g').innerHTML;
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
    render();
    fit();
  }

  function setLive(l) {
    live = l || { values: {} };
    render();
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
  };
})();
