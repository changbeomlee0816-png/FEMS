'use strict';

/**
 * FEMS 수용가 등록 엑셀 양식의 "공통코드" 정의.
 *
 * 원본 양식의 `5) 코드규칙` / `6) 요금제목록` 시트 값을 코드로 옮긴 것이다.
 * 업로드된 파일에 해당 시트가 있으면 그 값이 우선하고, 없으면 여기 값을 fallback 으로 쓴다.
 * (신규 설비코드/요금제가 생기면 이 파일만 갱신하면 된다.)
 */

// ── 설비코드 규칙 (5)코드규칙 B4:B33) ──────────────────────────────
const EQUIPMENT_CODES = [
  '펌프', '팬', '공기압축기', '냉동기', '냉각탑', '공조기', '수배전반', '열교환기',
  '증기보일러', '온수보일러', '공기열히트펌프', '수열히트펌프', '폐열히트펌프',
  '전기온수기', '흡수식냉온수기', '태양광', '성형기', '사출기', '압출기', '분쇄기',
  '인쇄기', '탈사기', '스크라바', '집진기', '올케이스로', '소성로', 'PIT로',
  'MCT', '프레스', '용접기',
];

// ── 에너지원 코드 규칙 (5)코드규칙 F5:G12) ─────────────────────────
const ENERGY_SOURCE_CODES = [
  { code: 1, name: '전력' },
  { code: 2, name: 'LNG' },
  { code: 3, name: 'LPG' },
  { code: 4, name: '프로판' },
  { code: 5, name: '부탄' },
  { code: 6, name: '경유' },
  { code: 7, name: '등유' },
  { code: 8, name: 'B-C유' },
];

// ── 요금제 목록 (6)요금제목록 A1:A36) ──────────────────────────────
const TARIFFS = [
  '산업용전력(갑) Ⅰ - 저압',
  '산업용전력(갑) Ⅰ - 고압 A - 선택 Ⅰ',
  '산업용전력(갑) Ⅰ - 고압 A - 선택 Ⅱ',
  '산업용전력(갑) Ⅰ - 고압 B - 선택 Ⅰ',
  '산업용전력(갑) Ⅰ - 고압 B - 선택 Ⅱ',
  '산업용전력(갑) Ⅱ - 고압 A - 선택 Ⅰ',
  '산업용전력(갑) Ⅱ - 고압 A - 선택 Ⅱ',
  '산업용전력(갑) Ⅱ - 고압 B - 선택 Ⅰ',
  '산업용전력(갑) Ⅱ - 고압 B - 선택 Ⅱ',
  '산업용전력(을) - 고압 A - 선택 Ⅰ',
  '산업용전력(을) - 고압 A - 선택 Ⅱ',
  '산업용전력(을) - 고압 A - 선택 Ⅲ',
  '산업용전력(을) - 고압 B - 선택 Ⅰ',
  '산업용전력(을) - 고압 B - 선택 Ⅱ',
  '산업용전력(을) - 고압 B - 선택 Ⅲ',
  '산업용전력(을) - 고압 C - 선택 Ⅰ',
  '산업용전력(을) - 고압 C - 선택 Ⅱ',
  '산업용전력(을) - 고압 C - 선택 Ⅲ',
  '일반용전력(갑) Ⅰ - 저압',
  '일반용전력(갑) Ⅰ - 고압 A - 선택 Ⅰ',
  '일반용전력(갑) Ⅰ - 고압 A - 선택 Ⅱ',
  '일반용전력(갑) Ⅰ - 고압 B - 선택 Ⅰ',
  '일반용전력(갑) Ⅰ - 고압 B - 선택 Ⅱ',
  '일반용전력(갑) Ⅱ - 고압 A - 선택 Ⅰ',
  '일반용전력(갑) Ⅱ - 고압 A - 선택 Ⅱ',
  '일반용전력(갑) Ⅱ - 고압 B - 선택 Ⅰ',
  '일반용전력(갑) Ⅱ - 고압 B - 선택 Ⅱ',
  '일반용전력(을) - 고압 A - 선택 Ⅰ',
  '일반용전력(을) - 고압 A - 선택 Ⅱ',
  '일반용전력(을) - 고압 A - 선택 Ⅲ',
  '일반용전력(을) - 고압 B - 선택 Ⅰ',
  '일반용전력(을) - 고압 B - 선택 Ⅱ',
  '일반용전력(을) - 고압 B - 선택 Ⅲ',
  '일반용전력(을) - 고압 C - 선택 Ⅰ',
  '일반용전력(을) - 고압 C - 선택 Ⅱ',
  '일반용전력(을) - 고압 C - 선택 Ⅲ',
];

// ── 4)장비속성 열거값 ──────────────────────────────────────────────
const MEASURE_TYPES = ['측정값', '변화값'];
const STAT_TYPES = ['평균', '합산', '마지막', '최대', '최소', '미사용'];

/**
 * 4)장비속성 의 매핑 열(O 표기) → 내부 role.
 * SCADA 도면의 각 노드가 어떤 계측값을 표시할지 결정하는 근거가 된다.
 */
const POINT_ROLES = [
  { col: 'M', label: '사용량', role: 'usage', tree: 'energy' },
  { col: 'N', label: '전력', role: 'power', tree: 'energy' },
  { col: 'O', label: '전류', role: 'current', tree: 'energy' },
  { col: 'P', label: '전압', role: 'voltage', tree: 'energy' },
  { col: 'Q', label: '무효전력', role: 'reactive', tree: 'energy' },
  { col: 'R', label: '역률', role: 'pf', tree: 'energy' },
  { col: 'S', label: 'THD', role: 'thd', tree: 'energy' },
  { col: 'T', label: 'Unbalance', role: 'unbalance', tree: 'energy' },
  { col: 'U', label: '에너지', role: 'energy', tree: 'facility' },
  { col: 'V', label: '가동시간', role: 'runtime', tree: 'facility' },
  { col: 'W', label: '효율', role: 'efficiency', tree: 'facility' },
];

/**
 * 설비코드 → SCADA 단선결선도 심볼.
 * 도면 자동 생성 시 각 계통/설비 노드의 그래픽 종류를 정한다.
 */
const SYMBOL_BY_EQUIPMENT = {
  수배전반: 'switchgear',
  태양광: 'pv',
  펌프: 'motor',
  팬: 'motor',
  공기압축기: 'motor',
  냉동기: 'motor',
  냉각탑: 'motor',
  공조기: 'motor',
  분쇄기: 'motor',
  집진기: 'motor',
  열교환기: 'heat',
  증기보일러: 'heat',
  온수보일러: 'heat',
  공기열히트펌프: 'heat',
  수열히트펌프: 'heat',
  폐열히트펌프: 'heat',
  전기온수기: 'heat',
  흡수식냉온수기: 'heat',
  올케이스로: 'furnace',
  소성로: 'furnace',
  PIT로: 'furnace',
  성형기: 'machine',
  사출기: 'machine',
  압출기: 'machine',
  인쇄기: 'machine',
  탈사기: 'machine',
  스크라바: 'machine',
  MCT: 'machine',
  프레스: 'machine',
  용접기: 'machine',
};


// ── 기기종류 코드 (SCADA 단선결선도 표기) ──────────────────────────
// 실제 관제화면(변전소 HMI)에 등장하는 기기들. 종류에 따라 도면 심볼과
// 표기할 정격 항목(정격전류/차단용량/용량)이 달라진다.
const DEVICE_KINDS = [
  { code: 'INCOMER', name: '수전점', group: '수전', symbol: 'utility' },
  { code: 'GCB', name: '가스차단기', group: '개폐기기', symbol: 'breaker' },
  { code: 'VCB', name: '진공차단기', group: '개폐기기', symbol: 'breaker' },
  { code: 'ACB', name: '기중차단기', group: '개폐기기', symbol: 'breaker' },
  { code: 'MCCB', name: '배선용차단기', group: '개폐기기', symbol: 'breaker' },
  { code: 'LBS', name: '부하개폐기', group: '개폐기기', symbol: 'switch' },
  { code: 'DS', name: '단로기', group: '개폐기기', symbol: 'switch' },
  { code: 'ES', name: '접지개폐기', group: '개폐기기', symbol: 'ground' },
  { code: 'ATS', name: '자동절체스위치', group: '개폐기기', symbol: 'switch' },
  { code: 'TR', name: '변압기', group: '변압', symbol: 'transformer' },
  { code: 'BUS', name: '모선', group: '모선', symbol: 'busbar' },
  { code: 'MOF', name: '계기용변성기', group: '계측', symbol: 'mof' },
  { code: 'CAP', name: '역률개선용콘덴서', group: '보상', symbol: 'capacitor' },
  { code: 'GEN', name: '발전기', group: '전원', symbol: 'generator' },
  { code: 'PV', name: '태양광', group: '전원', symbol: 'pv' },
  { code: 'ESS', name: '에너지저장장치', group: '전원', symbol: 'ess' },
  { code: 'UPS', name: '무정전전원장치', group: '전원', symbol: 'ups' },
  { code: 'MOTOR', name: '전동기부하', group: '부하', symbol: 'motor' },
  { code: 'LOAD', name: '일반부하', group: '부하', symbol: 'load' },
  { code: 'PANEL', name: '분전반', group: '부하', symbol: 'panel' },
];

/** 기기종류 → 도면 심볼 */
const SYMBOL_BY_DEVICE_KIND = Object.fromEntries(DEVICE_KINDS.map((d) => [d.code, d.symbol]));

// ── 보호계전 요소 (ANSI/IEEE Device Number) ────────────────────────
// 관제화면의 각 인출반에 표기되는 보호요소. 도면에서는 기기 옆 작은
// 박스로 나열된다 (사진의 50/51 · 51G · 87T 같은 표기).
const PROTECTION_CODES = [
  { code: '27', name: '부족전압' },
  { code: '32', name: '역전력' },
  { code: '32P', name: '역전력(유효)' },
  { code: '46', name: '역상과전류' },
  { code: '47', name: '결상/역상전압' },
  { code: '49', name: '과부하(열동)' },
  { code: '50', name: '순시과전류' },
  { code: '51', name: '한시과전류' },
  { code: '50N', name: '순시지락과전류' },
  { code: '51N', name: '한시지락과전류' },
  { code: '51G', name: '지락과전류' },
  { code: '59', name: '과전압' },
  { code: '59N', name: '지락과전압' },
  { code: '64', name: '지락' },
  { code: '67', name: '방향과전류' },
  { code: '67N', name: '방향지락' },
  { code: '81', name: '주파수' },
  { code: '86', name: '록아웃' },
  { code: '87T', name: '변압기 차동' },
  { code: '87B', name: '모선 차동' },
  { code: '87L', name: '선로 차동' },
];

/** 표준 전압 레벨(kV) — 표기 정규화와 오입력 감지에 쓴다 */
const VOLTAGE_LEVELS = [154, 66, 22.9, 6.6, 6.9, 3.3, 0.44, 0.4, 0.38, 0.22, 0.208];

/** 변압기 결선 표기 */
const VECTOR_GROUPS = ['Dyn11', 'Dyn1', 'Yyn0', 'YNyn0', 'YNd1', 'Dd0', 'Dy11', 'Yd1', 'Yzn11'];

/** 변압기 냉각방식 */
const COOLING_TYPES = ['ONAN', 'ONAF', 'OFAF', 'ODAF', 'AN', 'AF', 'OA', 'FA', 'OA/FA'];

/** 수전 회선 운전구분 */
const FEED_MODES = ['상시', '예비', '상시/예비', '병렬'];


// ── 계측 항목 카탈로그 ─────────────────────────────────────────────
// 도면의 각 포인트(설비)에 표시할 수 있는 계측 항목.
// 기본 4종은 관제에서 항상 보는 값이라 처음부터 켜져 있고,
// 나머지는 화면의 "표시 항목" 메뉴에서 켜고 끈다.
const MEASURE_CATALOG = [
  // 기본 — 유효전력량 · 전류 · 전압 · 역률
  { id: 'usage', label: '유효전력량', unit: 'kWh', short: '전력량', group: '기본', default: true },
  { id: 'current', label: '전류', unit: 'A', short: '전류', group: '기본', default: true },
  { id: 'voltage', label: '전압', unit: 'V', short: '전압', group: '기본', default: true },
  { id: 'pf', label: '역률', unit: '%', short: 'PF', group: '기본', default: true },

  // 전력 — 순시값
  { id: 'power', label: '유효전력', unit: 'kW', short: '전력', group: '전력' },
  { id: 'reactive', label: '무효전력', unit: 'kVAR', short: '무효', group: '전력' },
  { id: 'apparent', label: '피상전력', unit: 'kVA', short: '피상', group: '전력' },
  { id: 'frequency', label: '주파수', unit: 'Hz', short: '주파수', group: '전력' },

  // 전력품질
  { id: 'thd', label: 'THD', unit: '%', short: 'THD', group: '전력품질' },
  { id: 'unbalance', label: '불평형률', unit: '%', short: '불평형', group: '전력품질' },
  { id: 'reactiveEnergy', label: '무효전력량', unit: 'kVARh', short: '무효량', group: '전력품질' },

  // 설비 운전
  { id: 'energy', label: '에너지', unit: 'kWh', short: '에너지', group: '설비' },
  { id: 'runtime', label: '가동시간', unit: 'h', short: '가동', group: '설비' },
  { id: 'efficiency', label: '효율', unit: '%', short: '효율', group: '설비' },
  { id: 'status', label: '운전상태', unit: '', short: '상태', group: '설비' },

  // 타 에너지원 — 열·가스·용수 계측기를 붙인 경우
  { id: 'heat', label: '열량', unit: 'GJ', short: '열량', group: '타에너지' },
  { id: 'flow', label: '유량', unit: 'm3/h', short: '유량', group: '타에너지' },
  { id: 'gas', label: '가스', unit: 'Nm3', short: '가스', group: '타에너지' },
  { id: 'steam', label: '증기', unit: 't/h', short: '증기', group: '타에너지' },
  { id: 'water', label: '용수', unit: 'm3', short: '용수', group: '타에너지' },

  // 환경
  { id: 'temperature', label: '온도', unit: '\u2103', short: '온도', group: '환경' },
  { id: 'humidity', label: '습도', unit: '%', short: '습도', group: '환경' },
  { id: 'pressure', label: '압력', unit: 'bar', short: '압력', group: '환경' },
  { id: 'irradiance', label: '일사량', unit: 'W/m2', short: '일사', group: '환경' },
];

const MEASURE_BY_ID = Object.fromEntries(MEASURE_CATALOG.map((m) => [m.id, m]));

/** 처음부터 켜져 있는 표시 항목 — 유효전력량 · 전류 · 전압 · 역률 */
const DEFAULT_DISPLAY_ITEMS = MEASURE_CATALOG.filter((m) => m.default).map((m) => m.id);

/**
 * 포인트명으로 계측 항목을 추정한다.
 * 4)장비속성의 매핑 열(O 표시)이 없는 포인트도 이름만 보고 분류해서
 * "표시 항목" 메뉴에 올릴 수 있게 하기 위함이다.
 */
const NAME_HINTS = [
  [/유효전력량|적산전력량|사용량/, 'usage'],
  [/무효전력량/, 'reactiveEnergy'],
  [/유효전력/, 'power'],
  [/무효전력/, 'reactive'],
  [/피상전력/, 'apparent'],
  [/역률/, 'pf'],
  [/주파수/, 'frequency'],
  [/전류/, 'current'],
  [/전압/, 'voltage'],
  [/불평형/, 'unbalance'],
  [/thd|고조파/i, 'thd'],
  [/가동시간|운전시간/, 'runtime'],
  [/효율/, 'efficiency'],
  [/운전상태|부하운전|무부하/, 'status'],
  [/열량/, 'heat'],
  [/유량/, 'flow'],
  [/가스/, 'gas'],
  [/증기/, 'steam'],
  [/용수|급수/, 'water'],
  [/온도/, 'temperature'],
  [/습도/, 'humidity'],
  [/압력/, 'pressure'],
  [/일사/, 'irradiance'],
];

function measureFromName(name) {
  const n = String(name || '');
  for (const [re, id] of NAME_HINTS) if (re.test(n)) return id;
  return null;
}

/** 문자열 정규화: 공백/하이픈 제거 + 소문자. 'Accura 2300' 과 'Accura2300' 을 같은 값으로 본다. */
function normalizeKey(v) {
  return String(v == null ? '' : v).replace(/[\s_\-.]/g, '').toLowerCase();
}

/** 오타 후보 제안용 편집 거리 (정규화 후 비교) */
function editDistance(a, b) {
  const s = normalizeKey(a);
  const t = normalizeKey(b);
  const dp = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 0; j <= t.length; j++) dp[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[s.length][t.length];
}

/**
 * 후보 목록에서 가장 비슷한 값을 찾는다. 잘못 입력된 셀에
 * "혹시 'XXX' 를 입력하려던 것인가요?" 힌트를 붙이기 위해 사용.
 */
function closestMatch(value, candidates) {
  if (!value) return null;
  let best = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = editDistance(value, c);
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  const len = Math.max(normalizeKey(value).length, 1);
  return bestScore <= Math.max(2, Math.ceil(len * 0.4)) ? best : null;
}

module.exports = {
  EQUIPMENT_CODES,
  ENERGY_SOURCE_CODES,
  TARIFFS,
  MEASURE_TYPES,
  STAT_TYPES,
  POINT_ROLES,
  SYMBOL_BY_EQUIPMENT,
  DEVICE_KINDS,
  SYMBOL_BY_DEVICE_KIND,
  PROTECTION_CODES,
  VOLTAGE_LEVELS,
  VECTOR_GROUPS,
  COOLING_TYPES,
  FEED_MODES,
  MEASURE_CATALOG,
  MEASURE_BY_ID,
  DEFAULT_DISPLAY_ITEMS,
  measureFromName,
  normalizeKey,
  closestMatch,
};
