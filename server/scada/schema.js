'use strict';

/**
 * 「FEMS 수용가 등록 양식」 시트/열 스키마.
 *
 * 파서·검증기·프런트엔드(오류 안내 화면)가 모두 이 한 곳을 참조한다.
 * 양식이 개정되면 여기만 고치면 된다.
 */

const SHEETS = {
  BASIC: '0)기본정보',
  DEVICE: '1)장비',
  CHANNEL: '2)채널활성화 및 설비트리',
  ENERGY_TREE: '3)에너지트리',
  DEVICE_PROFILE: '4) 장비속성',
  CODE_RULE: '5) 코드규칙',
  TARIFF: '6) 요금제목록',
  // ── v2 (선택) — 실제 SCADA 단선결선도 수준으로 도면을 그리기 위한 시트.
  // 없어도 기존처럼 동작하고, 있으면 도면이 그만큼 상세해진다.
  INCOMER: '7) 수전계통',
  TRANSFORMER: '8) 변압기',
  ZONE: '9) 구역',
};

/** 없으면 도면 생성이 불가능한 시트 */
const REQUIRED_SHEETS = [SHEETS.BASIC, SHEETS.DEVICE, SHEETS.CHANNEL, SHEETS.ENERGY_TREE, SHEETS.DEVICE_PROFILE];

// ── 0)기본정보 : 라벨-값 형태 (값은 C열, 병합 C:F) ────────────────
/**
 * 0)기본정보 — 라벨-값 형태 (값은 C열, 병합 C:F)
 *
 * 도면 생성·검증·FEMS 연동에 실제로 쓰이는 항목만 남겼다.
 * 뺀 것: 홈페이지, 준공년도, 상주인력, 연평균 에너지사용량, 일평균 운영시간, 건물규모
 *        — 어디에도 쓰이지 않아 채우는 사람만 헷갈렸다.
 *        한전 파워플래너 계정·비밀번호는 **비밀번호를 엑셀로 주고받는 것 자체가 위험**해서 뺐다.
 *        (필요하면 시스템에서 직접 입력받는다)
 */
const BASIC_FIELDS = [
  { key: 'companyName', cell: 'C2', label: '회사명', required: true },
  { key: 'factoryCode', cell: 'C3', label: '공장코드(접속주소)', required: true, type: 'slug' },
  { key: 'industry', cell: 'C4', label: '업종' },
  { key: 'address', cell: 'C5', label: '주소', required: true },
  { key: 'phone', cell: 'C6', label: '전화번호', required: true, type: 'phone' },
  { key: 'masterAccountId', cell: 'C7', label: 'FEMS 마스터 계정ID', required: true, type: 'slug' },

  { key: 'managerName', cell: 'C10', label: '담당자명', required: true },
  { key: 'managerRank', cell: 'C11', label: '직급' },
  { key: 'managerMobile', cell: 'C12', label: '휴대전화번호', required: true, type: 'mobile' },
  { key: 'managerEmail', cell: 'C13', label: '이메일 주소', required: true, type: 'email' },

  { key: 'tariff', cell: 'C16', label: '신청 요금제', required: true, type: 'tariff' },
  { key: 'contractPower', cell: 'C17', label: '요금 적용 전력(kW)', required: true, type: 'number', min: 0 },
  { key: 'receivingCapacity', cell: 'C18', label: '수전용량(kW)', required: true, type: 'number', min: 0 },
];

/** 기본정보의 묶음 제목 — 양식에서 구역을 나눠 읽기 쉽게 한다 */
const BASIC_GROUPS = [
  { row: 1, title: '사업장' },
  { row: 9, title: '담당자' },
  { row: 15, title: '수전 계약' },
];
/**
 * 에너지원 정보 : 21~25행 × C~F열 (열 하나가 에너지원 1개)
 * 전력 외 에너지(가스·증기·용수…)를 함께 집계할 때만 채운다.
 * 쓰이지 않던 '탭표시명' 은 뺐다 — 종류가 그대로 화면 이름이 된다.
 */
const ENERGY_INFO = {
  cols: ['C', 'D', 'E', 'F'],
  rows: [
    { key: 'kind', row: 21, label: '종류', required: true },
    { key: 'baseUnit', row: 22, label: '기본 단위', required: true },
    { key: 'toeFactor', row: 23, label: '석유환산계수 [toe/단위]', type: 'number' },
    { key: 'co2Factor', row: 24, label: '탄소배출계수 [tCO2/단위]', type: 'number' },
    { key: 'unitPrice', row: 25, label: '단가 [원/단위]', type: 'number' },
  ],
};

// ── 1)장비 ─────────────────────────────────────────────────────────
const DEVICE_SHEET = {
  headerRow: 2,
  startRow: 3,
  identityCols: ['A', 'B', 'C', 'D', 'E'],
  columns: [
    { key: 'deviceId', col: 'A', label: '장비ID', required: true, type: 'int', min: 1, unique: true },
    { key: 'deviceType', col: 'B', label: '장비 타입', required: true },
    { key: 'productName', col: 'C', label: '제품명', required: true },
    { key: 'location', col: 'D', label: '설치 위치' },
    { key: 'ip', col: 'E', label: 'IP 주소', required: true, type: 'ipv4' },
    { key: 'port', col: 'F', label: '포트', type: 'int', min: 1, max: 65535 },
    { key: 'powerChannels', col: 'G', label: '전력 채널 수', type: 'int', min: 1 },
    { key: 'sendCycle', col: 'H', label: '전송주기(초)', type: 'int', min: 1 },
    { key: 'installedAt', col: 'I', label: '설치 일자', type: 'date' },
    { key: 'useYn', col: 'J', label: '사용여부', type: 'yn' },
  ],
};

// ── 2)채널활성화 및 설비트리 ───────────────────────────────────────
const CHANNEL_SHEET = {
  headerRow: 2,
  startRow: 3,
  identityCols: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  columns: [
    { key: 'deviceId', col: 'A', label: '장비ID', required: true, type: 'int', min: 1 },
    { key: 'channel', col: 'B', label: '채널정보', required: true, type: 'int', min: 1 },
    { key: 'loadName', col: 'C', label: '측정부하명', required: true },
    { key: 'equipmentCode', col: 'D', label: '설비코드정보' },
    { key: 'groupName', col: 'E', label: '설비그룹명' },
    { key: 'groupId', col: 'F', label: '설비그룹ID', type: 'int', min: 1 },
    { key: 'facilityName', col: 'G', label: '설비명' },
    { key: 'facilityId', col: 'H', label: '설비ID', type: 'int', min: 1 },
  ],
};

// ── 3)에너지트리 ───────────────────────────────────────────────────
const ENERGY_TREE_SHEET = {
  headerRow: 2,
  startRow: 3,
  identityCols: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  columns: [
    { key: 'energySource', col: 'A', label: '에너지원', required: true, type: 'int', min: 1 },
    { key: 'systemName', col: 'B', label: '계통명', required: true },
    { key: 'systemId', col: 'C', label: '에너지계통 ID', required: true, type: 'int', min: 1, unique: true },
    { key: 'level', col: 'D', label: '계통레벨', required: true, type: 'int', min: 1 },
    { key: 'parentId', col: 'E', label: '연결계통ID', required: true, type: 'int', min: 0 },
    { key: 'deviceId', col: 'F', label: '장비ID', type: 'int', min: 1 },
    { key: 'channel', col: 'G', label: '채널정보', type: 'int', min: 1 },
    // ── v2 확장 (모두 선택). 채우면 도면에 정격·보호요소가 함께 그려진다.
    { key: 'voltage', col: 'H', label: '전압(kV)', type: 'number', min: 0 },
    { key: 'deviceKind', col: 'I', label: '기기종류', type: 'enum:deviceKind' },
    { key: 'ratedCurrent', col: 'J', label: '정격전류(A)', type: 'number', min: 0 },
    { key: 'breakingCapacity', col: 'K', label: '차단용량(kA)', type: 'number', min: 0 },
    { key: 'ratedPower', col: 'L', label: '정격용량(kW)', type: 'number', min: 0 },
    { key: 'protection', col: 'M', label: '보호요소' },
    { key: 'zoneCode', col: 'N', label: '구역코드' },
    { key: 'tag', col: 'O', label: '기기TAG' },
  ],
};

// ── 7)수전계통 : 한전 수전 회선 (RCP-1 / RCP-2 처럼 회선별로 한 행) ──
const INCOMER_SHEET = {
  headerRow: 2,
  startRow: 3,
  identityCols: ['A', 'B', 'C'],
  columns: [
    { key: 'lineId', col: 'A', label: '회선ID', required: true, type: 'int', min: 1, unique: true },
    { key: 'lineName', col: 'B', label: '회선명', required: true },
    { key: 'substation', col: 'C', label: '공급 변전소' },
    { key: 'voltage', col: 'D', label: '수전전압(kV)', required: true, type: 'number', min: 0 },
    { key: 'contractPower', col: 'E', label: '계약전력(kW)', type: 'number', min: 0 },
    { key: 'cableSpec', col: 'F', label: '케이블 규격' },
    { key: 'feedMode', col: 'G', label: '운전구분', type: 'enum:feedMode' },
    { key: 'systemId', col: 'H', label: '연결계통ID', required: true, type: 'int', min: 1 },
  ],
};

// ── 8)변압기 : TR 제원 + 온도 감시 포인트 ─────────────────────────
const TRANSFORMER_SHEET = {
  headerRow: 2,
  startRow: 3,
  identityCols: ['A', 'B'],
  columns: [
    { key: 'trId', col: 'A', label: '변압기ID', required: true, type: 'int', min: 1, unique: true },
    { key: 'name', col: 'B', label: '변압기명', required: true },
    { key: 'systemId', col: 'C', label: '연결계통ID', required: true, type: 'int', min: 1 },
    { key: 'primaryVoltage', col: 'D', label: '1차전압(kV)', required: true, type: 'number', min: 0 },
    { key: 'secondaryVoltage', col: 'E', label: '2차전압(kV)', required: true, type: 'number', min: 0 },
    { key: 'capacity', col: 'F', label: '용량(kVA)', required: true, type: 'number', min: 0 },
    { key: 'vectorGroup', col: 'G', label: '결선' },
    { key: 'impedance', col: 'H', label: '%임피던스', type: 'number', min: 0, max: 100 },
    { key: 'cooling', col: 'I', label: '냉각방식' },
    { key: 'windingTempDevice', col: 'J', label: '권선온도 장비ID', type: 'int', min: 1 },
    { key: 'windingTempChannel', col: 'K', label: '권선온도 채널', type: 'int', min: 1 },
    { key: 'oilTempDevice', col: 'L', label: '유온 장비ID', type: 'int', min: 1 },
    { key: 'oilTempChannel', col: 'M', label: '유온 채널', type: 'int', min: 1 },
  ],
};

// ── 9)구역 : SCADA 화면 분할 (변전동 / 기계전기실 / P1F EAST …) ────
const ZONE_SHEET = {
  headerRow: 2,
  startRow: 3,
  identityCols: ['A', 'B'],
  columns: [
    { key: 'zoneCode', col: 'A', label: '구역코드', required: true, unique: true },
    { key: 'zoneName', col: 'B', label: '구역명', required: true },
    { key: 'order', col: 'C', label: '표시순서', type: 'int', min: 1 },
    { key: 'note', col: 'D', label: '설명' },
  ],
};

// ── 4)장비속성 ─────────────────────────────────────────────────────
const DEVICE_PROFILE_SHEET = {
  headerRow: 3,
  startRow: 4,
  // A/B(장비타입·제품명)는 병합 셀이라 아래로 이어짐 → forward fill 대상
  fillCols: ['A', 'B'],
  identityCols: ['C', 'D', 'F'],
  columns: [
    { key: 'deviceType', col: 'A', label: '계측기 및 연동장비', fill: true },
    { key: 'productName', col: 'B', label: '제품명', fill: true },
    { key: 'address', col: 'C', label: 'Address', required: true },
    { key: 'sourcePoint', col: 'D', label: '포인트정보' },
    { key: 'unit', col: 'E', label: '단위' },
    { key: 'pointName', col: 'F', label: '포인트명', required: true },
    { key: 'measureType', col: 'G', label: '계측유형', type: 'enum:measure' },
    { key: 'statType', col: 'H', label: '통계유형', type: 'enum:stat' },
    { key: 'scale', col: 'I', label: '배율', type: 'number' },
    { key: 'funcCode', col: 'J', label: 'Func Code', type: 'int' },
    { key: 'pointType', col: 'K', label: 'Point Type', type: 'int' },
    { key: 'pointSize', col: 'L', label: 'Point Size', type: 'number' },
  ],
};

// ── 5)코드규칙 / 6)요금제목록 ─────────────────────────────────────
const CODE_RULE_SHEET = {
  equipment: { col: 'B', startRow: 4, endRow: 60 },
  energySource: { codeCol: 'F', nameCol: 'G', startRow: 5, endRow: 20 },
};
const TARIFF_SHEET = { col: 'A', startRow: 1, endRow: 200 };

module.exports = {
  SHEETS,
  REQUIRED_SHEETS,
  BASIC_FIELDS,
  BASIC_GROUPS,
  ENERGY_INFO,
  DEVICE_SHEET,
  CHANNEL_SHEET,
  ENERGY_TREE_SHEET,
  DEVICE_PROFILE_SHEET,
  CODE_RULE_SHEET,
  TARIFF_SHEET,
  INCOMER_SHEET,
  TRANSFORMER_SHEET,
  ZONE_SHEET,
};
