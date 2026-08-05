/* global window */
'use strict';

/**
 * 단선결선도 심볼 라이브러리.
 *
 * 모든 심볼은 (cx, cy) 를 중심으로 하는 정사각 영역에 그려지며 SVG 마크업
 * 문자열을 돌려준다. 전력 계통도 관례(IEC 60617 / KS C 0102 약식, ANSI 기기번호)를
 * 따르되, 화면에서 작게 보여도 서로 구분되도록 단순화했다.
 *
 * 팔레트(메뉴바)는 CATALOG 하나만 보고 만들어진다. 심볼을 추가하려면
 * REGISTRY 에 그리는 함수를, CATALOG 에 한 줄을 넣으면 끝이다.
 */
window.ScadaSymbols = (function () {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── 공통 조각 ──────────────────────────────────────────────────
  /** 심볼 안 글자 (원·사각 안의 M, G, A, V …) */
  const txt = (cx, cy, size, s, weight) =>
    `<text class="nd-sym-fill" x="${cx}" y="${cy + size * 0.35}" text-anchor="middle" font-size="${size}" font-weight="${weight || 700}">${esc(s)}</text>`;

  /** 위아래 인출선 — 결선에 물리는 기기(차단기·퓨즈 등)에 붙인다 */
  const leads = (cx, cy, r, inner) =>
    `<line class="nd-sym" x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy - inner}" />
     <line class="nd-sym" x1="${cx}" y1="${cy + inner}" x2="${cx}" y2="${cy + r}" />`;

  const rect = (cx, cy, w, h, rx) =>
    `<rect class="nd-sym" x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${rx == null ? 2 : rx}" />`;

  const circle = (cx, cy, r) => `<circle class="nd-sym" cx="${cx}" cy="${cy}" r="${r}" />`;

  const line = (x1, y1, x2, y2) => `<line class="nd-sym" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;

  /** 원 안에 글자 — M(전동기) G(발전기) A(전류계) 처럼 관례로 굳은 표기 */
  const lettered = (letter, scale) => (cx, cy, r) =>
    circle(cx, cy, r) + txt(cx, cy, r * (scale || 1.15), letter);

  /** 사각 안에 글자 */
  const boxed = (letter, scale) => (cx, cy, r) =>
    rect(cx, cy, r * 1.9, r * 1.5) + txt(cx, cy, r * (scale || 0.9), letter);

  /** 교류 물결 */
  const wave = (cx, cy, w) =>
    `<path class="nd-sym" d="M${cx - w} ${cy} q ${w / 2} ${-w * 0.9} ${w} 0 q ${w / 2} ${w * 0.9} ${w} 0" />`;

  // ── 전원 ───────────────────────────────────────────────────────
  /** 한전 수전점 — 계통 전원. 원 안에 물결(교류). */
  function utility(cx, cy, r) {
    return circle(cx, cy, r) + wave(cx, cy, r * 0.55);
  }

  const generator = lettered('G');

  /** 태양광 — 셀 격자 + 빗변 */
  function pv(cx, cy, r) {
    const a = r * 0.92;
    return rect(cx, cy, a * 2, a * 1.4, 1.5) +
      line(cx - a, cy + a * 0.7, cx + a, cy - a * 0.7) +
      line(cx, cy - a * 0.7, cx, cy + a * 0.7);
  }

  /** 풍력 — 허브 + 날개 3장 */
  function wind(cx, cy, r) {
    let out = `<circle class="nd-sym-fill" cx="${cx}" cy="${cy}" r="${r * 0.16}" />`;
    for (let i = 0; i < 3; i++) {
      const a = (i * 120 - 90) * Math.PI / 180;
      out += line(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return out;
  }

  /** ESS / 축전지 — 길고 짧은 판 반복 */
  function ess(cx, cy, r) {
    const g = r * 0.42;
    let out = '';
    for (let i = -1; i <= 1; i++) {
      out += line(cx + i * g - r * 0.1, cy - r * 0.75, cx + i * g - r * 0.1, cy + r * 0.75);
      out += line(cx + i * g + r * 0.16, cy - r * 0.38, cx + i * g + r * 0.16, cy + r * 0.38);
    }
    return out;
  }

  /** UPS — 사각 안에 직류(직선)와 교류(물결) */
  function ups(cx, cy, r) {
    const a = r * 0.9;
    return rect(cx, cy, a * 2, a * 1.4) +
      line(cx - a * 0.6, cy + a * 0.45, cx + a * 0.6, cy - a * 0.45) +
      `<path class="nd-sym" d="M${cx - a * 0.62} ${cy - a * 0.22} q ${a * 0.16} ${-a * 0.3} ${a * 0.32} 0" />` +
      line(cx + a * 0.2, cy + a * 0.3, cx + a * 0.6, cy + a * 0.3);
  }

  const fuelcell = boxed('FC', 0.72);

  /** PCS(인버터) — 직류 → 교류. 사각 안 대각선 기준 좌:직선, 우:물결 */
  function pcs(cx, cy, r) {
    const a = r * 0.92;
    return rect(cx, cy, a * 2, a * 1.5) +
      line(cx - a * 0.75, cy + a * 0.6, cx + a * 0.75, cy - a * 0.6) +
      line(cx - a * 0.66, cy - a * 0.35, cx - a * 0.24, cy - a * 0.35) +
      `<path class="nd-sym" d="M${cx + a * 0.2} ${cy + a * 0.36} q ${a * 0.14} ${-a * 0.28} ${a * 0.28} 0 q ${a * 0.14} ${a * 0.28} ${a * 0.28} 0" />`;
  }

  /** 정류기 — 교류 → 직류 (PCS 의 반대) */
  function rectifier(cx, cy, r) {
    const a = r * 0.92;
    return rect(cx, cy, a * 2, a * 1.5) +
      line(cx - a * 0.75, cy + a * 0.6, cx + a * 0.75, cy - a * 0.6) +
      `<path class="nd-sym" d="M${cx - a * 0.68} ${cy - a * 0.3} q ${a * 0.14} ${-a * 0.28} ${a * 0.28} 0 q ${a * 0.14} ${a * 0.28} ${a * 0.28} 0" />` +
      line(cx + a * 0.24, cy + a * 0.34, cx + a * 0.66, cy + a * 0.34);
  }

  // ── 변압 · 보상 ────────────────────────────────────────────────
  /** 변압기 — 겹친 두 원 (2권선) */
  function transformer(cx, cy, r) {
    const o = r * 0.42;
    return circle(cx, cy - o, r * 0.72) + circle(cx, cy + o, r * 0.72);
  }

  /** 3권선 변압기 — 삼각 배치 세 원 */
  function transformer3(cx, cy, r) {
    const a = r * 0.5;
    return circle(cx, cy - a * 0.9, r * 0.56) +
      circle(cx - a, cy + a * 0.6, r * 0.56) +
      circle(cx + a, cy + a * 0.6, r * 0.56);
  }

  /** 단권변압기 — 원 하나 + 탭 인출 */
  function autotransformer(cx, cy, r) {
    return circle(cx, cy, r * 0.8) +
      line(cx - r * 0.8, cy + r * 0.55, cx + r * 0.55, cy - r * 0.8) +
      line(cx + r * 0.2, cy - r * 0.45, cx + r, cy - r * 0.45);
  }

  /** 계기용변압기 PT/VT — 나란한 두 원 + 2차 인출 */
  function pt(cx, cy, r) {
    return circle(cx - r * 0.34, cy, r * 0.6) + circle(cx + r * 0.34, cy, r * 0.6) +
      line(cx, cy + r * 0.6, cx, cy + r);
  }

  /** 변류기 CT — 주회로를 감싸는 원 (도체가 원을 관통) */
  function ct(cx, cy, r) {
    return line(cx, cy - r, cx, cy + r) +
      `<circle class="nd-sym" cx="${cx + r * 0.42}" cy="${cy}" r="${r * 0.52}" />`;
  }

  /** 영상변류기 ZCT — 3상 도체를 한 번에 감싸는 원 */
  function zct(cx, cy, r) {
    return circle(cx, cy, r * 0.86) +
      line(cx - r * 0.34, cy - r, cx - r * 0.34, cy + r) +
      line(cx, cy - r, cx, cy + r) +
      line(cx + r * 0.34, cy - r, cx + r * 0.34, cy + r);
  }

  /** 계기용변성기 MOF(PCT) — 원 + 라벨 */
  function mofSym(cx, cy, r) {
    return circle(cx, cy, r) + txt(cx, cy, r * 0.72, 'MOF');
  }

  /** 리액터 — 반원 코일 3개 */
  function reactor(cx, cy, r) {
    const w = r * 0.5;
    let d = `M${cx} ${cy - r}`;
    for (let i = 0; i < 3; i++) d += ` a ${w} ${w} 0 0 1 0 ${w * 1.0}`;
    return `<path class="nd-sym" d="${d}" />` + line(cx, cy + r * 0.5, cx, cy + r);
  }

  /** 역률개선용 콘덴서 — 평행 두 판 */
  function capacitor(cx, cy, r) {
    return line(cx, cy - r, cx, cy - r * 0.28) +
      line(cx - r * 0.8, cy - r * 0.28, cx + r * 0.8, cy - r * 0.28) +
      line(cx - r * 0.8, cy + r * 0.16, cx + r * 0.8, cy + r * 0.16) +
      line(cx, cy + r * 0.16, cx, cy + r);
  }

  /** 중성점 접지저항 NGR — 저항 상자 + 접지 */
  function ngr(cx, cy, r) {
    return line(cx, cy - r, cx, cy - r * 0.55) +
      rect(cx, cy - r * 0.05, r * 0.8, r, 1) +
      ground(cx, cy + r * 0.62, r * 1.1);
  }

  // ── 개폐 · 차단 ────────────────────────────────────────────────
  /** 차단기 CB — 결선 위 사각 (모든 차단기의 기본형) */
  function breakerSym(cx, cy, r) {
    const a = r * 0.62;
    return leads(cx, cy, r, a) + rect(cx, cy, a * 2, a * 2, 1.5);
  }

  /** 진공차단기 VCB — 사각 + 진공 인터럽터(원) */
  function vcb(cx, cy, r) {
    const a = r * 0.62;
    return leads(cx, cy, r, a) + rect(cx, cy, a * 2, a * 2, 1.5) +
      `<circle class="nd-sym" cx="${cx}" cy="${cy}" r="${a * 0.46}" />`;
  }

  /** 기중차단기 ACB — 사각 + 인출형(draw-out) 꺾쇠 */
  function acb(cx, cy, r) {
    const a = r * 0.62;
    return leads(cx, cy, r, a) + rect(cx, cy, a * 2, a * 2, 1.5) +
      `<path class="nd-sym" d="M${cx - a * 1.5} ${cy - a * 0.6} h${a * 0.45} v${a * 1.2} h${-a * 0.45}" />` +
      `<path class="nd-sym" d="M${cx + a * 1.5} ${cy - a * 0.6} h${-a * 0.45} v${a * 1.2} h${a * 0.45}" />`;
  }

  /** 가스차단기 GCB — 사각 + SF6 표기 점 */
  function gcb(cx, cy, r) {
    const a = r * 0.62;
    return leads(cx, cy, r, a) + rect(cx, cy, a * 2, a * 2, 1.5) +
      `<circle class="nd-sym-fill" cx="${cx - a * 0.4}" cy="${cy}" r="${a * 0.16}" />` +
      `<circle class="nd-sym-fill" cx="${cx + a * 0.4}" cy="${cy}" r="${a * 0.16}" />`;
  }

  /** 배선용차단기 MCCB — 모울드 케이스(둥근 사각) + 대각 */
  function mccb(cx, cy, r) {
    const a = r * 0.6;
    return leads(cx, cy, r, a) + rect(cx, cy, a * 1.7, a * 2, a * 0.6) +
      line(cx - a * 0.6, cy + a * 0.62, cx + a * 0.6, cy - a * 0.62);
  }

  /** 누전차단기 ELCB — MCCB + 영상변류기 */
  function elcb(cx, cy, r) {
    const a = r * 0.6;
    return mccb(cx, cy, r) +
      `<ellipse class="nd-sym" cx="${cx}" cy="${cy + a * 0.05}" rx="${a * 1.15}" ry="${a * 1.4}" />`;
  }

  /** 단로기 DS — 열린 칼날 */
  function switchSym(cx, cy, r) {
    return line(cx, cy - r, cx, cy - r * 0.45) +
      line(cx, cy - r * 0.45, cx + r * 0.75, cy + r * 0.5) +
      line(cx, cy + r * 0.5, cx, cy + r) +
      `<circle class="nd-sym-fill" cx="${cx}" cy="${cy - r * 0.45}" r="${r * 0.13}" />
       <circle class="nd-sym-fill" cx="${cx}" cy="${cy + r * 0.5}" r="${r * 0.13}" />`;
  }

  /** 부하개폐기 LBS — 칼날 + 소호(부하차단) 반원 */
  function lbs(cx, cy, r) {
    return switchSym(cx, cy, r) +
      `<path class="nd-sym" d="M${cx - r * 0.34} ${cy + r * 0.5} a ${r * 0.34} ${r * 0.34} 0 0 1 ${r * 0.68} 0" />`;
  }

  /** 접지개폐기 ES — 칼날이 접지로 떨어진다 */
  function es(cx, cy, r) {
    return line(cx, cy - r, cx, cy - r * 0.4) +
      line(cx, cy - r * 0.4, cx + r * 0.7, cy + r * 0.15) +
      `<circle class="nd-sym-fill" cx="${cx}" cy="${cy - r * 0.4}" r="${r * 0.13}" />` +
      ground(cx, cy + r * 0.42, r * 1.2);
  }

  /** 컷아웃스위치 COS — 퓨즈통 + 힌지 */
  function cos(cx, cy, r) {
    const a = r * 0.55;
    return leads(cx, cy, r, a * 1.35) + rect(cx, cy, a * 1.2, a * 2.7, 1) +
      `<circle class="nd-sym-fill" cx="${cx}" cy="${cy + a * 1.35}" r="${r * 0.13}" />`;
  }

  /** 전력퓨즈 PF — 결선 위 직사각형 */
  function fuse(cx, cy, r) {
    const a = r * 0.55;
    return leads(cx, cy, r, a * 1.3) + rect(cx, cy, a * 1.15, a * 2.6, 1) +
      line(cx, cy - a * 1.3, cx, cy + a * 1.3);
  }

  /** 자동절체스위치 ATS — 두 전원 중 하나를 고른다 */
  function ats(cx, cy, r) {
    return line(cx - r * 0.7, cy - r, cx - r * 0.7, cy - r * 0.45) +
      line(cx + r * 0.7, cy - r, cx + r * 0.7, cy - r * 0.45) +
      line(cx - r * 0.7, cy - r * 0.45, cx, cy + r * 0.35) +
      `<circle class="nd-sym-fill" cx="${cx - r * 0.7}" cy="${cy - r * 0.45}" r="${r * 0.13}" />
       <circle class="nd-sym-fill" cx="${cx + r * 0.7}" cy="${cy - r * 0.45}" r="${r * 0.13}" />` +
      line(cx, cy + r * 0.35, cx, cy + r);
  }

  /** 전자접촉기 MC — 칼날 + 반원 접점 */
  function contactor(cx, cy, r) {
    return line(cx, cy - r, cx, cy - r * 0.45) +
      line(cx, cy - r * 0.45, cx + r * 0.7, cy + r * 0.35) +
      `<path class="nd-sym" d="M${cx - r * 0.3} ${cy + r * 0.45} a ${r * 0.3} ${r * 0.3} 0 0 0 ${r * 0.6} 0" />` +
      line(cx, cy + r * 0.45, cx, cy + r);
  }

  // ── 보호 · 계측 ────────────────────────────────────────────────
  /** 보호계전기 — 원 안에 ANSI 기기번호 자리 */
  function relay(cx, cy, r) {
    return circle(cx, cy, r) + txt(cx, cy, r * 0.78, '51');
  }

  const meter = lettered('Wh', 0.8);
  const ammeter = lettered('A');
  const voltmeter = lettered('V');

  /** 피뢰기 LA — 상자 + 화살 + 접지 */
  function la(cx, cy, r) {
    return line(cx, cy - r, cx, cy - r * 0.62) +
      rect(cx, cy - r * 0.1, r * 0.8, r * 1.05, 1) +
      `<path class="nd-sym" d="M${cx} ${cy - r * 0.5} v${r * 0.85} m${-r * 0.2} ${-r * 0.28} l${r * 0.2} ${r * 0.28} l${r * 0.2} ${-r * 0.28}" />` +
      ground(cx, cy + r * 0.66, r * 1.05);
  }

  /** 서지보호기 SPD — 저압반의 낙뢰·개폐 서지 보호 (사각 + 화살 + 접지) */
  function spd(cx, cy, r) {
    return line(cx, cy - r, cx, cy - r * 0.6) +
      rect(cx, cy - r * 0.08, r * 1.1, r * 1.05, 1) +
      `<path class="nd-sym" d="M${cx - r * 0.3} ${cy - r * 0.42} l${r * 0.6} ${r * 0.68} m0 ${-r * 0.34} v${r * 0.34} h${-r * 0.34}" />` +
      ground(cx, cy + r * 0.68, r * 1.05);
  }

  /** 누전경보기 ELD — 영상변류기 + 경보 */
  function eld(cx, cy, r) {
    return line(cx, cy - r, cx, cy + r) +
      `<ellipse class="nd-sym" cx="${cx}" cy="${cy}" rx="${r * 0.85}" ry="${r * 0.6}" />` +
      txt(cx + r * 0.02, cy, r * 0.62, 'E');
  }

  /** 케이블헤드 CH — 케이블 종단 접속재 (스트레스콘 형상) */
  function ch(cx, cy, r) {
    return line(cx, cy - r, cx, cy - r * 0.3) +
      `<path class="nd-sym" d="M${cx - r * 0.62} ${cy + r * 0.75} L${cx - r * 0.2} ${cy - r * 0.3} h${r * 0.4} L${cx + r * 0.62} ${cy + r * 0.75} z" />` +
      line(cx, cy + r * 0.75, cx, cy + r);
  }

  /** 서지흡수기 SA — 맞물린 두 삼각 + 접지 */
  function sa(cx, cy, r) {
    return line(cx, cy - r, cx, cy - r * 0.5) +
      `<path class="nd-sym" d="M${cx - r * 0.5} ${cy - r * 0.5} h${r} l${-r * 0.5} ${r * 0.5} z" />` +
      `<path class="nd-sym" d="M${cx - r * 0.5} ${cy + r * 0.5} h${r} l${-r * 0.5} ${-r * 0.5} z" />` +
      ground(cx, cy + r * 0.62, r * 1.05);
  }

  // ── 부하 ───────────────────────────────────────────────────────
  const motor = lettered('M');

  /** 인버터 구동 전동기 VFD — 전동기 + 구동부 사각 */
  function vfd(cx, cy, r) {
    return rect(cx, cy - r * 0.55, r * 1.7, r * 0.72, 1.5) +
      line(cx - r * 0.55, cy - r * 0.35, cx + r * 0.5, cy - r * 0.75) +
      circle(cx, cy + r * 0.45, r * 0.62) + txt(cx, cy + r * 0.45, r * 0.8, 'M');
  }

  /** 펌프 — 원 + 임펠러 화살 */
  function pump(cx, cy, r) {
    return circle(cx, cy, r) +
      `<path class="nd-sym-fill" d="M${cx - r * 0.35} ${cy - r * 0.45} L${cx + r * 0.55} ${cy} L${cx - r * 0.35} ${cy + r * 0.45} Z" />`;
  }

  /** 송풍기·팬 — 허브 + 날개 3장(채움) */
  function fan(cx, cy, r) {
    let out = circle(cx, cy, r);
    for (let i = 0; i < 3; i++) {
      const a = (i * 120 - 90) * Math.PI / 180;
      const b = a + 0.55;
      out += `<path class="nd-sym-fill" d="M${cx} ${cy} L${cx + Math.cos(a) * r * 0.85} ${cy + Math.sin(a) * r * 0.85} A ${r * 0.85} ${r * 0.85} 0 0 1 ${cx + Math.cos(b) * r * 0.85} ${cy + Math.sin(b) * r * 0.85} Z" />`;
    }
    return out;
  }

  /** 공기압축기 — 원 + 사다리꼴(압축) */
  function compressor(cx, cy, r) {
    return circle(cx, cy, r) +
      `<path class="nd-sym" d="M${cx - r * 0.55} ${cy - r * 0.5} L${cx + r * 0.55} ${cy - r * 0.18} L${cx + r * 0.55} ${cy + r * 0.18} L${cx - r * 0.55} ${cy + r * 0.5} Z" />`;
  }

  /** 냉동기 — 상자 + 냉매 눈꽃 */
  function chiller(cx, cy, r) {
    const a = r * 0.9;
    let out = rect(cx, cy, a * 2, a * 1.5);
    for (let i = 0; i < 3; i++) {
      const ang = (i * 60) * Math.PI / 180;
      out += line(cx - Math.cos(ang) * a * 0.55, cy - Math.sin(ang) * a * 0.55, cx + Math.cos(ang) * a * 0.55, cy + Math.sin(ang) * a * 0.55);
    }
    return out;
  }

  /** 공조기 AHU — 상자 + 코일 + 팬 */
  function ahu(cx, cy, r) {
    const a = r * 0.95;
    return rect(cx, cy, a * 2, a * 1.5) +
      line(cx - a * 0.15, cy - a * 0.75, cx - a * 0.15, cy + a * 0.75) +
      `<path class="nd-sym" d="M${cx - a * 0.8} ${cy - a * 0.4} q ${a * 0.2} ${a * 0.4} ${a * 0.4} 0 q ${a * 0.2} ${-a * 0.4} ${a * 0.4} 0" />` +
      `<circle class="nd-sym" cx="${cx + a * 0.42}" cy="${cy}" r="${a * 0.42}" />`;
  }

  /** 열설비(보일러·히트펌프·열교환) — 원 안에 열파형 */
  function heat(cx, cy, r) {
    return circle(cx, cy, r) +
      `<path class="nd-sym" d="M${cx - r * 0.5} ${cy + r * 0.35} q ${r * 0.25} ${-r * 0.7} ${r * 0.5} 0 q ${r * 0.25} ${r * 0.7} ${r * 0.5} 0" />
       <path class="nd-sym" d="M${cx - r * 0.5} ${cy - r * 0.2} q ${r * 0.25} ${-r * 0.7} ${r * 0.5} 0 q ${r * 0.25} ${r * 0.7} ${r * 0.5} 0" />`;
  }

  /** 로(爐) — 굴뚝 달린 상자 */
  function furnace(cx, cy, r) {
    const a = r * 0.9;
    return rect(cx, cy + a * 0.18, a * 2, a * 1.3) +
      `<path class="nd-sym" d="M${cx - a * 0.35} ${cy - a * 0.45} v${-a * 0.6} h${a * 0.7} v${a * 0.6}" />` +
      line(cx - a * 0.5, cy + a * 0.35, cx + a * 0.5, cy + a * 0.35);
  }

  /** 생산설비(사출·압출·프레스) — 톱니 상자 */
  function machine(cx, cy, r) {
    const a = r * 0.88;
    return rect(cx, cy, a * 2, a * 1.56) +
      line(cx - a * 0.45, cy - a * 0.78, cx - a * 0.45, cy + a * 0.78) +
      `<circle class="nd-sym" cx="${cx + a * 0.32}" cy="${cy}" r="${a * 0.42}" />`;
  }

  /** 조명 — 원 + X */
  function lighting(cx, cy, r) {
    const d = r * 0.62;
    return circle(cx, cy, r * 0.86) +
      line(cx - d, cy - d, cx + d, cy + d) + line(cx - d, cy + d, cx + d, cy - d);
  }

  /** 전열설비 — 상자 + 지그재그(저항) */
  function heater(cx, cy, r) {
    const a = r * 0.9;
    return rect(cx, cy, a * 2, a * 1.3) +
      `<path class="nd-sym" d="M${cx - a * 0.7} ${cy} l${a * 0.23} ${-a * 0.42} l${a * 0.47} ${a * 0.84} l${a * 0.47} ${-a * 0.84} l${a * 0.23} ${a * 0.42}" />`;
  }

  /** EV 충전기 — 기둥 + 플러그 */
  function evcharger(cx, cy, r) {
    const a = r * 0.75;
    return rect(cx - a * 0.35, cy, a * 1.3, a * 2, 1.5) +
      `<path class="nd-sym" d="M${cx + a * 0.35} ${cy - a * 0.5} h${a * 0.6} v${a} " />` +
      txt(cx - a * 0.35, cy, a * 0.95, '⚡', 400);
  }

  /** 일반 부하 — 삼각형 */
  function load(cx, cy, r) {
    return `<path class="nd-sym" d="M${cx} ${cy - r * 0.85} L${cx + r * 0.9} ${cy + r * 0.7} L${cx - r * 0.9} ${cy + r * 0.7} Z" />`;
  }

  // ── 계통 · 기타 ────────────────────────────────────────────────
  /** 수배전반 / 스위치기어 — 이중 사각형 */
  function switchgear(cx, cy, r) {
    const a = r * 0.95;
    return rect(cx, cy, a * 2, a * 1.44) +
      line(cx - a, cy - a * 0.24, cx + a, cy - a * 0.24) +
      line(cx - a * 0.34, cy - a * 0.24, cx - a * 0.34, cy + a * 0.72) +
      line(cx + a * 0.34, cy - a * 0.24, cx + a * 0.34, cy + a * 0.72);
  }

  /** 분전반 — 칸 나뉜 상자 */
  function panel(cx, cy, r) {
    const a = r * 0.92;
    return rect(cx, cy, a * 2, a * 1.6, 1.5) +
      line(cx - a, cy - a * 0.2, cx + a, cy - a * 0.2) +
      line(cx - a, cy + a * 0.3, cx + a, cy + a * 0.3);
  }

  /** 모선 — 굵은 가로 막대 */
  function busbar(cx, cy, r) {
    return `<line class="nd-sym" x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke-width="4" stroke-linecap="round" />`;
  }

  /** 접지 (노드용) */
  function groundSym(cx, cy, r) {
    return ground(cx, cy, r * 1.4);
  }

  /** 케이블·인입 — 도체 + 실드 */
  function cable(cx, cy, r) {
    return line(cx, cy - r, cx, cy + r) +
      `<path class="nd-sym" d="M${cx - r * 0.45} ${cy - r * 0.45} a ${r * 0.45} ${r * 0.6} 0 0 0 0 ${r * 0.9}" />` +
      `<path class="nd-sym" d="M${cx + r * 0.45} ${cy - r * 0.45} a ${r * 0.45} ${r * 0.6} 0 0 1 0 ${r * 0.9}" />`;
  }

  // ── 결선 위에 얹는 글리프 ──────────────────────────────────────
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
    return circle(cx, cy, r) +
      `<text class="nd-sub" x="${cx}" y="${cy + r * 0.35}" font-size="${r * 0.9}" text-anchor="middle">MOF</text>`;
  }

  /** 접지 */
  function ground(cx, cy, w) {
    return line(cx, cy - w * 0.5, cx, cy) +
      line(cx - w * 0.5, cy, cx + w * 0.5, cy) +
      line(cx - w * 0.32, cy + w * 0.22, cx + w * 0.32, cy + w * 0.22) +
      line(cx - w * 0.14, cy + w * 0.44, cx + w * 0.14, cy + w * 0.44);
  }

  // ── 레지스트리 & 팔레트 카탈로그 ───────────────────────────────
  const REGISTRY = {
    // 전원
    utility, generator, pv, wind, ess, ups, fuelcell, pcs, rectifier,
    // 변압·보상
    transformer, transformer3, autotransformer, pt, ct, zct, mof: mofSym, reactor, capacitor, ngr,
    // 개폐·차단
    breaker: breakerSym, vcb, acb, gcb, mccb, elcb, switch: switchSym, lbs, es, cos, fuse, ats, contactor,
    // 보호·계측
    relay, meter, ammeter, voltmeter, la, sa, spd, eld, ch,
    // 부하
    motor, vfd, pump, fan, compressor, chiller, ahu, heat, furnace, machine, lighting, heater, evcharger, load,
    // 계통·기타
    switchgear, panel, busbar, ground: groundSym, cable,
  };

  /**
   * 팔레트 카탈로그.
   *  id    REGISTRY 키
   *  label 사람이 읽는 이름
   *  group 메뉴바 분류
   *  kind  기기종류 코드 (엑셀 `3)에너지트리` 의 기기종류와 같은 체계)
   *  name  새로 넣을 때 기본 설비명
   */
  const CATALOG = [
    // 전원
    { id: 'utility', label: '한전 수전점', group: '전원', kind: 'INCOMER', name: '한전 수전', root: true },
    { id: 'generator', label: '발전기', group: '전원', kind: 'GEN', name: '비상발전기', root: true },
    { id: 'pv', label: '태양광', group: '전원', kind: 'PV', name: '태양광 발전' },
    { id: 'wind', label: '풍력', group: '전원', kind: 'WIND', name: '풍력 발전' },
    { id: 'ess', label: 'ESS·축전지', group: '전원', kind: 'ESS', name: 'ESS' },
    { id: 'ups', label: 'UPS', group: '전원', kind: 'UPS', name: 'UPS' },
    { id: 'fuelcell', label: '연료전지', group: '전원', kind: 'FC', name: '연료전지' },
    { id: 'pcs', label: 'PCS·인버터', group: '전원', kind: 'PCS', name: 'PCS' },
    { id: 'rectifier', label: '정류기', group: '전원', kind: 'RECT', name: '정류기' },

    // 변압·보상
    { id: 'transformer', label: '변압기 (2권선)', group: '변압·보상', kind: 'TR', name: '변압기' },
    { id: 'transformer3', label: '3권선 변압기', group: '변압·보상', kind: 'TR3', name: '3권선 변압기' },
    { id: 'autotransformer', label: '단권변압기', group: '변압·보상', kind: 'ATR', name: '단권변압기' },
    { id: 'pt', label: '계기용변압기 PT', group: '변압·보상', kind: 'PT', name: 'PT' },
    { id: 'ct', label: '변류기 CT', group: '변압·보상', kind: 'CT', name: 'CT' },
    { id: 'zct', label: '영상변류기 ZCT', group: '변압·보상', kind: 'ZCT', name: 'ZCT' },
    { id: 'mof', label: '계기용변성기 MOF', group: '변압·보상', kind: 'MOF', name: 'MOF' },
    { id: 'reactor', label: '리액터 SR', group: '변압·보상', kind: 'SR', name: '직렬리액터' },
    { id: 'capacitor', label: '콘덴서 SC', group: '변압·보상', kind: 'CAP', name: '역률개선 콘덴서' },
    { id: 'ngr', label: '중성점 접지저항', group: '변압·보상', kind: 'NGR', name: 'NGR' },

    // 개폐·차단
    { id: 'breaker', label: '차단기 CB', group: '개폐·차단', kind: 'CB', name: '차단기' },
    { id: 'vcb', label: '진공차단기 VCB', group: '개폐·차단', kind: 'VCB', name: 'VCB' },
    { id: 'acb', label: '기중차단기 ACB', group: '개폐·차단', kind: 'ACB', name: 'ACB' },
    { id: 'gcb', label: '가스차단기 GCB', group: '개폐·차단', kind: 'GCB', name: 'GCB' },
    { id: 'mccb', label: '배선용차단기 MCCB', group: '개폐·차단', kind: 'MCCB', name: 'MCCB' },
    { id: 'elcb', label: '누전차단기 ELCB', group: '개폐·차단', kind: 'ELCB', name: 'ELCB' },
    { id: 'switch', label: '단로기 DS', group: '개폐·차단', kind: 'DS', name: '단로기' },
    { id: 'lbs', label: '부하개폐기 LBS', group: '개폐·차단', kind: 'LBS', name: 'LBS' },
    { id: 'es', label: '접지개폐기 ES', group: '개폐·차단', kind: 'ES', name: '접지개폐기' },
    { id: 'cos', label: '컷아웃스위치 COS', group: '개폐·차단', kind: 'COS', name: 'COS' },
    { id: 'fuse', label: '전력퓨즈 PF', group: '개폐·차단', kind: 'PF', name: '전력퓨즈' },
    { id: 'ats', label: '자동절체 ATS', group: '개폐·차단', kind: 'ATS', name: 'ATS' },
    { id: 'contactor', label: '전자접촉기 MC', group: '개폐·차단', kind: 'MC', name: '전자접촉기' },

    // 보호·계측
    { id: 'relay', label: '보호계전기', group: '보호·계측', kind: 'RELAY', name: '보호계전기' },
    { id: 'meter', label: '전력량계', group: '보호·계측', kind: 'METER', name: '전력량계' },
    { id: 'ammeter', label: '전류계', group: '보호·계측', kind: 'AM', name: '전류계' },
    { id: 'voltmeter', label: '전압계', group: '보호·계측', kind: 'VM', name: '전압계' },
    { id: 'la', label: '피뢰기 LA', group: '보호·계측', kind: 'LA', name: '피뢰기' },
    { id: 'sa', label: '서지흡수기 SA', group: '보호·계측', kind: 'SA', name: '서지흡수기' },
    { id: 'spd', label: '서지보호기 SPD', group: '보호·계측', kind: 'SPD', name: 'SPD' },
    { id: 'eld', label: '누전경보기 ELD', group: '보호·계측', kind: 'ELD', name: '누전경보기' },
    { id: 'ch', label: '케이블헤드 CH', group: '계통·기타', kind: 'CH', name: '케이블헤드' },

    // 부하
    { id: 'motor', label: '전동기', group: '부하', kind: 'MOTOR', name: '전동기' },
    { id: 'vfd', label: '인버터 구동 VFD', group: '부하', kind: 'VFD', name: 'VFD 전동기' },
    { id: 'pump', label: '펌프', group: '부하', kind: 'PUMP', name: '펌프' },
    { id: 'fan', label: '송풍기·팬', group: '부하', kind: 'FAN', name: '송풍기' },
    { id: 'compressor', label: '공기압축기', group: '부하', kind: 'COMP', name: '공기압축기' },
    { id: 'chiller', label: '냉동기', group: '부하', kind: 'CHILLER', name: '냉동기' },
    { id: 'ahu', label: '공조기 AHU', group: '부하', kind: 'AHU', name: '공조기' },
    { id: 'heat', label: '열설비·보일러', group: '부하', kind: 'HEAT', name: '보일러' },
    { id: 'furnace', label: '로(爐)', group: '부하', kind: 'FURNACE', name: '용해로' },
    { id: 'machine', label: '생산설비', group: '부하', kind: 'MACHINE', name: '생산설비' },
    { id: 'lighting', label: '조명', group: '부하', kind: 'LIGHT', name: '조명' },
    { id: 'heater', label: '전열설비', group: '부하', kind: 'HEATER', name: '전열기' },
    { id: 'evcharger', label: 'EV 충전기', group: '부하', kind: 'EVC', name: 'EV 충전기' },
    { id: 'load', label: '일반 부하', group: '부하', kind: 'LOAD', name: '부하' },

    // 계통·기타
    { id: 'switchgear', label: '수배전반', group: '계통·기타', kind: 'SWGR', name: '수배전반' },
    { id: 'panel', label: '분전반', group: '계통·기타', kind: 'PANEL', name: '분전반' },
    { id: 'busbar', label: '모선 BUS', group: '계통·기타', kind: 'BUS', name: '모선' },
    { id: 'ground', label: '접지', group: '계통·기타', kind: 'GND', name: '접지' },
    { id: 'cable', label: '케이블·인입', group: '계통·기타', kind: 'CABLE', name: '인입 케이블' },
  ];

  const BY_ID = {};
  const LABELS = {};
  for (const s of CATALOG) {
    BY_ID[s.id] = s;
    LABELS[s.id] = s.label;
  }

  /** 메뉴바용 그룹 목록 (카탈로그 순서 유지) */
  const GROUPS = [];
  for (const s of CATALOG) {
    let g = GROUPS.filter((x) => x.name === s.group)[0];
    if (!g) GROUPS.push((g = { name: s.group, items: [] }));
    g.items.push(s);
  }

  /** 심볼 마크업 (알 수 없는 종류는 일반 부하로) */
  function draw(kind, cx, cy, r) {
    return (REGISTRY[kind] || load)(cx, cy, r);
  }

  return {
    draw, breaker, mof, ground, esc,
    LABELS, kinds: Object.keys(REGISTRY),
    CATALOG, GROUPS, byId: (id) => BY_ID[id] || null,
  };
})();
