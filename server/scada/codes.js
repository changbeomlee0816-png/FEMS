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
  normalizeKey,
  closestMatch,
};
