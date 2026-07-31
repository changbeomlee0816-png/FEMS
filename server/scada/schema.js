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
};

/** 없으면 도면 생성이 불가능한 시트 */
const REQUIRED_SHEETS = [SHEETS.BASIC, SHEETS.DEVICE, SHEETS.CHANNEL, SHEETS.ENERGY_TREE, SHEETS.DEVICE_PROFILE];

// ── 0)기본정보 : 라벨-값 형태 (값은 C열, 병합 C:F) ────────────────
const BASIC_FIELDS = [
  { key: 'companyName', cell: 'C2', label: '회사명', required: true },
  { key: 'industry', cell: 'C3', label: '업종' },
  { key: 'homepage', cell: 'C4', label: '홈페이지 주소' },
  { key: 'phone', cell: 'C5', label: '전화번호', required: true, type: 'phone' },
  { key: 'address', cell: 'C6', label: '주소', required: true },
  { key: 'masterAccountId', cell: 'C7', label: 'FEMS 마스터 계정ID', required: true, type: 'slug' },
  { key: 'factoryCode', cell: 'C8', label: '공장코드(접속주소)', required: true, type: 'slug' },
  { key: 'tariff', cell: 'C9', label: '신청 요금제', required: true, type: 'tariff' },
  { key: 'kepcoAccount', cell: 'C10', label: '한전파워플래너 계정' },
  { key: 'kepcoPassword', cell: 'C11', label: '한전파워플래너 비밀번호', secret: true },
  { key: 'managerName', cell: 'C12', label: '담당자명', required: true },
  { key: 'managerRank', cell: 'C13', label: '직급' },
  { key: 'managerMobile', cell: 'C14', label: '휴대전화번호', required: true, type: 'mobile' },
  { key: 'managerEmail', cell: 'C15', label: '이메일 주소', required: true, type: 'email' },
  { key: 'builtYear', cell: 'C20', label: '준공년도', type: 'year' },
  { key: 'headcount', cell: 'C21', label: '상주인력', type: 'number' },
  { key: 'annualEnergyToe', cell: 'C22', label: '연평균 에너지 사용량(toe)', type: 'number' },
  { key: 'dailyOperatingHours', cell: 'C23', label: '일 평균 운영시간(hour/day)', type: 'number', max: 24 },
  { key: 'contractPower', cell: 'C24', label: '요금 적용 전력(kW)', required: true, type: 'number', min: 0 },
  { key: 'receivingCapacity', cell: 'C25', label: '수전용량(kW)', required: true, type: 'number', min: 0 },
];

/** 기타 > 건물규모 : 라벨 18행 / 값 19행 (C~F) */
const BUILDING_SCALE = { labelRow: 18, valueRow: 19, cols: ['C', 'D', 'E', 'F'] };
/** 기타 > 에너지원 : 라벨 16행 / 값 17행 (C~F) */
const ENERGY_USE = { labelRow: 16, valueRow: 17, cols: ['C', 'D', 'E', 'F'] };

/** 에너지 정보 : 27~32행 × C~F열 (열 하나가 에너지원 1개) */
const ENERGY_INFO = {
  cols: ['C', 'D', 'E', 'F'],
  rows: [
    { key: 'kind', row: 27, label: '종류', required: true },
    { key: 'baseUnit', row: 28, label: '에너지원 기본 단위', required: true },
    { key: 'tabName', row: 29, label: '탭표시명', required: true },
    { key: 'toeFactor', row: 30, label: '석유환산계수[toe/기본단위]', type: 'number' },
    { key: 'co2Factor', row: 31, label: '탄소배출계수[tco2/기본단위]', type: 'number' },
    { key: 'unitPrice', row: 32, label: '에너지 단가[원/기본단위]', type: 'number' },
  ],
};

// ── 1)장비 ─────────────────────────────────────────────────────────
const DEVICE_SHEET = {
  headerRow: 2,
  startRow: 3,
  identityCols: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  columns: [
    { key: 'deviceId', col: 'A', label: '장비ID', required: true, type: 'int', min: 1, unique: true },
    { key: 'deviceType', col: 'B', label: '장비 타입', required: true },
    { key: 'productName', col: 'C', label: '제품명', required: true },
    { key: 'measuredFacility', col: 'D', label: '측정설비' },
    { key: 'location', col: 'E', label: '장비 위치' },
    { key: 'ip', col: 'F', label: 'IP 주소', required: true, type: 'ipv4' },
    { key: 'installedAt', col: 'G', label: '설치 일자', type: 'date' },
    { key: 'protocolType', col: 'I', label: '프로토콜 타입' },
    { key: 'engineId', col: 'J', label: '엔진 ID' },
    { key: 'offset', col: 'K', label: 'Offset', type: 'int' },
    { key: 'port', col: 'L', label: '포트', type: 'int', min: 1, max: 65535 },
    { key: 'sendCycle', col: 'M', label: '전송주기', type: 'int', min: 1 },
    { key: 'monitorCycle', col: 'N', label: '모니터링 주기', type: 'int', min: 1 },
    { key: 'powerChannels', col: 'O', label: '전력 채널 수', type: 'int', min: 1 },
    { key: 'calcYn', col: 'P', label: '계산 여부', type: 'yn' },
    { key: 'useYn', col: 'Q', label: '사용여부', type: 'yn' },
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
  BUILDING_SCALE,
  ENERGY_USE,
  ENERGY_INFO,
  DEVICE_SHEET,
  CHANNEL_SHEET,
  ENERGY_TREE_SHEET,
  DEVICE_PROFILE_SHEET,
  CODE_RULE_SHEET,
  TARIFF_SHEET,
};
