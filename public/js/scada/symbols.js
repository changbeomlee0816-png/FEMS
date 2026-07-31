/* global window */
'use strict';

/**
 * 단선결선도 심볼 라이브러리.
 *
 * 모든 심볼은 (cx, cy) 를 중심으로 하는 정사각 영역에 그려지며 SVG 마크업
 * 문자열을 돌려준다. 전력 계통도 관례(IEC/ANSI 약식)를 따르되, 화면에서
 * 작게 보여도 구분되도록 단순화했다.
 */
window.ScadaSymbols = (function () {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** 한전 수전점 — 계통 전원. 원 안에 물결(교류) 표시. */
  function utility(cx, cy, r) {
    return `
      <circle class="nd-sym" cx="${cx}" cy="${cy}" r="${r}" />
      <path class="nd-sym" d="M${cx - r * 0.55} ${cy} q ${r * 0.275} ${-r * 0.5} ${r * 0.55} 0 q ${r * 0.275} ${r * 0.5} ${r * 0.55} 0" />`;
  }

  /** 수배전반 / 스위치기어 — 이중 사각형 */
  function switchgear(cx, cy, r) {
    const a = r * 0.95;
    return `
      <rect class="nd-sym" x="${cx - a}" y="${cy - a * 0.72}" width="${a * 2}" height="${a * 1.44}" rx="2" />
      <line class="nd-sym" x1="${cx - a}" y1="${cy - a * 0.24}" x2="${cx + a}" y2="${cy - a * 0.24}" />
      <line class="nd-sym" x1="${cx - a * 0.34}" y1="${cy - a * 0.24}" x2="${cx - a * 0.34}" y2="${cy + a * 0.72}" />
      <line class="nd-sym" x1="${cx + a * 0.34}" y1="${cy - a * 0.24}" x2="${cx + a * 0.34}" y2="${cy + a * 0.72}" />`;
  }

  /** 전동기 부하 — 원 안에 M */
  function motor(cx, cy, r) {
    return `
      <circle class="nd-sym" cx="${cx}" cy="${cy}" r="${r}" />
      <text class="nd-sym-fill" x="${cx}" y="${cy + r * 0.38}" text-anchor="middle" font-size="${r * 1.15}" font-weight="700">M</text>`;
  }

  /** 태양광 — 셀 격자 + 빗변 */
  function pv(cx, cy, r) {
    const a = r * 0.92;
    return `
      <rect class="nd-sym" x="${cx - a}" y="${cy - a * 0.7}" width="${a * 2}" height="${a * 1.4}" rx="1.5" />
      <line class="nd-sym" x1="${cx - a}" y1="${cy + a * 0.7}" x2="${cx + a}" y2="${cy - a * 0.7}" />
      <line class="nd-sym" x1="${cx}" y1="${cy - a * 0.7}" x2="${cx}" y2="${cy + a * 0.7}" />`;
  }

  /** 열설비(보일러/히트펌프/열교환) — 원 안에 열파형 */
  function heat(cx, cy, r) {
    return `
      <circle class="nd-sym" cx="${cx}" cy="${cy}" r="${r}" />
      <path class="nd-sym" d="M${cx - r * 0.5} ${cy + r * 0.35} q ${r * 0.25} ${-r * 0.7} ${r * 0.5} 0 q ${r * 0.25} ${r * 0.7} ${r * 0.5} 0" />
      <path class="nd-sym" d="M${cx - r * 0.5} ${cy - r * 0.2} q ${r * 0.25} ${-r * 0.7} ${r * 0.5} 0 q ${r * 0.25} ${r * 0.7} ${r * 0.5} 0" />`;
  }

  /** 로(爐) — 굴뚝 달린 상자 */
  function furnace(cx, cy, r) {
    const a = r * 0.9;
    return `
      <rect class="nd-sym" x="${cx - a}" y="${cy - a * 0.45}" width="${a * 2}" height="${a * 1.3}" rx="2" />
      <path class="nd-sym" d="M${cx - a * 0.35} ${cy - a * 0.45} v${-a * 0.6} h${a * 0.7} v${a * 0.6}" />
      <line class="nd-sym" x1="${cx - a * 0.5}" y1="${cy + a * 0.35}" x2="${cx + a * 0.5}" y2="${cy + a * 0.35}" />`;
  }

  /** 생산설비(사출·압출·프레스 등) — 톱니 상자 */
  function machine(cx, cy, r) {
    const a = r * 0.88;
    return `
      <rect class="nd-sym" x="${cx - a}" y="${cy - a * 0.78}" width="${a * 2}" height="${a * 1.56}" rx="2" />
      <line class="nd-sym" x1="${cx - a * 0.45}" y1="${cy - a * 0.78}" x2="${cx - a * 0.45}" y2="${cy + a * 0.78}" />
      <circle class="nd-sym" cx="${cx + a * 0.32}" cy="${cy}" r="${a * 0.42}" />`;
  }

  /** 일반 부하 — 삼각형 */
  function load(cx, cy, r) {
    return `<path class="nd-sym" d="M${cx} ${cy - r * 0.85} L${cx + r * 0.9} ${cy + r * 0.7} L${cx - r * 0.9} ${cy + r * 0.7} Z" />`;
  }


  /** 변압기 — 겹친 두 원 (2권선) */
  function transformer(cx, cy, r) {
    const o = r * 0.42;
    return `
      <circle class="nd-sym" cx="${cx}" cy="${cy - o}" r="${r * 0.72}" />
      <circle class="nd-sym" cx="${cx}" cy="${cy + o}" r="${r * 0.72}" />`;
  }

  /** 발전기 — 원 안에 G */
  function generator(cx, cy, r) {
    return `
      <circle class="nd-sym" cx="${cx}" cy="${cy}" r="${r}" />
      <text class="nd-sym-fill" x="${cx}" y="${cy + r * 0.38}" text-anchor="middle" font-size="${r * 1.15}" font-weight="700">G</text>`;
  }

  /** 역률개선용 콘덴서 — 평행 두 판 */
  function capacitor(cx, cy, r) {
    return `
      <line class="nd-sym" x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy - r * 0.28}" />
      <line class="nd-sym" x1="${cx - r * 0.8}" y1="${cy - r * 0.28}" x2="${cx + r * 0.8}" y2="${cy - r * 0.28}" />
      <line class="nd-sym" x1="${cx - r * 0.8}" y1="${cy + r * 0.16}" x2="${cx + r * 0.8}" y2="${cy + r * 0.16}" />
      <line class="nd-sym" x1="${cx}" y1="${cy + r * 0.16}" x2="${cx}" y2="${cy + r}" />`;
  }

  /** ESS / 축전지 — 길고 짧은 판 반복 */
  function ess(cx, cy, r) {
    const g = r * 0.42;
    let out = '';
    for (let i = -1; i <= 1; i++) {
      out += `<line class="nd-sym" x1="${cx + i * g - r * 0.1}" y1="${cy - r * 0.75}" x2="${cx + i * g - r * 0.1}" y2="${cy + r * 0.75}" />`;
      out += `<line class="nd-sym" x1="${cx + i * g + r * 0.16}" y1="${cy - r * 0.38}" x2="${cx + i * g + r * 0.16}" y2="${cy + r * 0.38}" />`;
    }
    return out;
  }

  /** UPS — 사각 안에 물결(교류)과 직선(직류) */
  function ups(cx, cy, r) {
    const a = r * 0.9;
    return `
      <rect class="nd-sym" x="${cx - a}" y="${cy - a * 0.7}" width="${a * 2}" height="${a * 1.4}" rx="2" />
      <line class="nd-sym" x1="${cx - a * 0.6}" y1="${cy + a * 0.45}" x2="${cx + a * 0.6}" y2="${cy - a * 0.45}" />
      <path class="nd-sym" d="M${cx - a * 0.62} ${cy - a * 0.22} q ${a * 0.16} ${-a * 0.3} ${a * 0.32} 0" />
      <line class="nd-sym" x1="${cx + a * 0.2}" y1="${cy + a * 0.3}" x2="${cx + a * 0.6}" y2="${cy + a * 0.3}" />`;
  }

  /** 분전반 — 칸 나뉜 상자 */
  function panel(cx, cy, r) {
    const a = r * 0.92;
    return `
      <rect class="nd-sym" x="${cx - a}" y="${cy - a * 0.8}" width="${a * 2}" height="${a * 1.6}" rx="1.5" />
      <line class="nd-sym" x1="${cx - a}" y1="${cy - a * 0.2}" x2="${cx + a}" y2="${cy - a * 0.2}" />
      <line class="nd-sym" x1="${cx - a}" y1="${cy + a * 0.3}" x2="${cx + a}" y2="${cy + a * 0.3}" />`;
  }

  /** 개폐기(단로기·LBS) — 열린 칼날 */
  function switchSym(cx, cy, r) {
    return `
      <line class="nd-sym" x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy - r * 0.45}" />
      <line class="nd-sym" x1="${cx}" y1="${cy - r * 0.45}" x2="${cx + r * 0.75}" y2="${cy + r * 0.5}" />
      <line class="nd-sym" x1="${cx}" y1="${cy + r * 0.5}" x2="${cx}" y2="${cy + r}" />
      <circle class="nd-sym-fill" cx="${cx}" cy="${cy - r * 0.45}" r="${r * 0.13}" />
      <circle class="nd-sym-fill" cx="${cx}" cy="${cy + r * 0.5}" r="${r * 0.13}" />`;
  }

  /** 차단기 심볼(노드용) — 사각 + 통과선 */
  function breakerSym(cx, cy, r) {
    const a = r * 0.62;
    return `
      <line class="nd-sym" x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy - a}" />
      <rect class="nd-sym" x="${cx - a}" y="${cy - a}" width="${a * 2}" height="${a * 2}" rx="1.5" />
      <line class="nd-sym" x1="${cx}" y1="${cy + a}" x2="${cx}" y2="${cy + r}" />`;
  }

  /** 모선 — 굵은 가로 막대 */
  function busbar(cx, cy, r) {
    return `<line class="nd-sym" x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke-width="4" stroke-linecap="round" />`;
  }

  /** 접지 (노드용) */
  function groundSym(cx, cy, r) {
    return ground(cx, cy, r * 1.4);
  }

  const REGISTRY = {
    utility, switchgear, motor, pv, heat, furnace, machine, load,
    transformer, generator, capacitor, ess, ups, panel,
    switch: switchSym, breaker: breakerSym, busbar, ground: groundSym,
  };

  /** 심볼 마크업 (알 수 없는 종류는 일반 부하로) */
  function draw(kind, cx, cy, r) {
    return (REGISTRY[kind] || load)(cx, cy, r);
  }

  /**
   * 차단기(CB) — 결선 위에 얹는 정사각 글리프.
   * 투입(closed)은 채워진 사각, 개방(open)은 빈 사각으로 구분한다.
   */
  function breaker(cx, cy, size, closed) {
    const h = size / 2;
    return `<rect class="cb ${closed ? 'is-closed' : 'is-open'}" x="${cx - h}" y="${cy - h}" width="${size}" height="${size}" rx="1.5" />`;
  }

  /** 계기용변성기(MOF) — 결선 위 원 + 라벨 */
  function mof(cx, cy, r) {
    return `
      <circle class="nd-sym" cx="${cx}" cy="${cy}" r="${r}" />
      <text class="nd-sub" x="${cx}" y="${cy + r * 0.35}" font-size="${r * 0.9}" text-anchor="middle">MOF</text>`;
  }

  /** 접지 */
  function ground(cx, cy, w) {
    return `
      <line class="nd-sym" x1="${cx}" y1="${cy - w * 0.5}" x2="${cx}" y2="${cy}" />
      <line class="nd-sym" x1="${cx - w * 0.5}" y1="${cy}" x2="${cx + w * 0.5}" y2="${cy}" />
      <line class="nd-sym" x1="${cx - w * 0.32}" y1="${cy + w * 0.22}" x2="${cx + w * 0.32}" y2="${cy + w * 0.22}" />
      <line class="nd-sym" x1="${cx - w * 0.14}" y1="${cy + w * 0.44}" x2="${cx + w * 0.14}" y2="${cy + w * 0.44}" />`;
  }

  const LABELS = {
    utility: '수전', switchgear: '수배전반', motor: '전동기', pv: '태양광',
    heat: '열설비', furnace: '로', machine: '생산설비', load: '부하',
    transformer: '변압기', generator: '발전기', capacitor: '콘덴서',
    ess: 'ESS', ups: 'UPS', panel: '분전반',
    switch: '개폐기', breaker: '차단기', busbar: '모선', ground: '접지',
  };

  return { draw, breaker, mof, ground, esc, LABELS, kinds: Object.keys(REGISTRY) };
})();
