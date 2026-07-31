'use strict';

/**
 * 「FEMS 수용가 등록 양식」 생성기.
 *
 * 스키마(schema.js)와 코드표(codes.js)를 그대로 읽어 엑셀을 만든다.
 * 그래서 열을 추가하거나 코드가 늘어나면 **양식이 자동으로 따라온다** —
 * 검증기와 양식이 어긋날 일이 없다.
 *
 *   mode: 'example' (기본) — 실제 수전 계통을 본뜬 기입 예시가 들어간 양식
 *   mode: 'blank'          — 머리글·코드표·작성요령만 있는 빈 양식
 *
 * 예시 데이터는 154kV 2회선 수전 → 주변압기 → 22.9kV 모선 → 저압/부하 구성으로,
 * 실제 공장 관제화면(수전 2회선 · 자가발전 · 구역별 화면)에서 흔한 형태다.
 */

const ExcelJS = require('exceljs');
const S = require('./schema');
const codes = require('./codes');
const { normalizeZipTimestamps } = require('./zip-normalize');

// ── 서식 ────────────────────────────────────────────────────────────
const C = {
  head: 'FF1F3864', // 머리글 배경
  headText: 'FFFFFFFF',
  req: 'FFFFF2CC', // 필수 입력칸
  opt: 'FFF2F2F2', // 선택 입력칸
  note: 'FF7F7F7F',
  section: 'FFD9E2F3',
};

function styleHeader(cell, text, required) {
  cell.value = (required ? '* ' : '') + text;
  cell.font = { bold: true, color: { argb: C.headText }, size: 10 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.head } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = {
    top: { style: 'thin' }, left: { style: 'thin' },
    bottom: { style: 'thin' }, right: { style: 'thin' },
  };
}

function styleInput(cell, required) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? C.req : C.opt } };
  cell.border = {
    top: { style: 'hair' }, left: { style: 'hair' },
    bottom: { style: 'hair' }, right: { style: 'hair' },
  };
  cell.alignment = { vertical: 'middle' };
}

/** 스키마 columns 로 표 시트의 머리글 + 입력칸 서식을 깐다 */
function layoutTable(ws, spec, title, rowsToPaint = 40) {
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { bold: true, size: 12 };

  for (const c of spec.columns) {
    const cell = ws.getCell(`${c.col}${spec.headerRow}`);
    styleHeader(cell, c.label, !!c.required);
    const col = ws.getColumn(c.col);
    col.width = Math.max(12, Math.min(26, String(c.label).length * 1.9 + 4));
  }
  for (let r = spec.startRow; r < spec.startRow + rowsToPaint; r++) {
    for (const c of spec.columns) styleInput(ws.getCell(`${c.col}${r}`), !!c.required);
  }
  ws.views = [{ state: 'frozen', ySplit: spec.headerRow }];
}

/** 표 오른쪽에 작성 요령을 붙인다 */
function writeGuide(ws, spec, guide, startCol) {
  const colIndex = ws.getColumn(startCol).number;
  ws.getCell(spec.headerRow - 1, colIndex).value = '작성 요령';
  ws.getCell(spec.headerRow - 1, colIndex).font = { bold: true, size: 10 };
  ws.getCell(spec.headerRow, colIndex).value = '열';
  ws.getCell(spec.headerRow, colIndex + 1).value = '설명';
  for (const c of [colIndex, colIndex + 1]) {
    const cell = ws.getCell(spec.headerRow, c);
    cell.font = { bold: true, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.section } };
  }
  ws.getColumn(colIndex).width = 18;
  ws.getColumn(colIndex + 1).width = 62;
  let r = spec.startRow;
  for (const [label, text] of guide) {
    ws.getCell(r, colIndex).value = label;
    ws.getCell(r, colIndex).font = { size: 9, bold: true };
    ws.getCell(r, colIndex + 1).value = text;
    ws.getCell(r, colIndex + 1).font = { size: 9, color: { argb: C.note } };
    ws.getCell(r, colIndex + 1).alignment = { wrapText: true, vertical: 'top' };
    r++;
  }
}

function fillRows(ws, spec, rows) {
  rows.forEach((row, i) => {
    const r = spec.startRow + i;
    spec.columns.forEach((c) => {
      if (row[c.key] === undefined || row[c.key] === null) return;
      ws.getCell(`${c.col}${r}`).value = row[c.key];
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// 예시 데이터 — 154kV 2회선 수전 공장
// ══════════════════════════════════════════════════════════════════

const EX_BASIC = {
  C2: '대한정밀산업', C3: '자동차부품제조업', C4: 'http://www.daehan-example.co.kr/',
  C5: '031-777-2200', C6: '경기도 평택시 산단로 108',
  C7: 'daehan', C8: 'daehan', C9: '산업용전력(을) - 고압 A - 선택 Ⅱ',
  C10: '0212345678', C11: 'kepco-pw-2026',
  C12: '이창범', C13: '차장', C14: '010-2345-6789', C15: 'cb.lee@daehan-example.co.kr',
  C19: 3, D19: 4, E19: 5, F19: 48000,
  C20: 2016, C21: 320, C22: 9800, C23: 24,
  C24: 42000, C25: 50000,
  C27: '전기', C28: 'kWh', C29: '전력', C30: 0.00023, C31: 0.0004594, C32: 151.2,
};

// [장비ID, 장비타입, 제품명, 측정설비, 위치, IP]
const EX_DEVICES = [
  [1, '전력량계', 'Accura 2300', '제1수전 154kV 인입', '변전동 전기실', '10.10.1.11'],
  [2, '전력량계', 'Accura 2300', '제2수전 154kV 인입', '변전동 전기실', '10.10.1.12'],
  [3, '전력량계', 'Accura 2300', '주변압기 1 2차', '변전동 전기실', '10.10.1.13'],
  [4, '전력량계', 'Accura 2300', '주변압기 2 2차', '변전동 전기실', '10.10.1.14'],
  [5, '전력량계', 'MPM330a', '기계전기실 배전반', '기계전기실', '10.10.2.21'],
  [6, '전력량계', 'MPM330a', '제조1동 배전반', '제조1동 전기실', '10.10.3.31'],
  [7, '전력량계', 'MPM330a', '가스터빈 발전기', '발전실', '10.10.4.41'],
  [8, '전력량계', 'MPM330a', '태양광 인버터', '옥상 PV', '10.10.5.51'],
];

// [장비ID, 채널, 측정부하명, 설비코드, 설비그룹명, 설비그룹ID, 설비명, 설비ID]
const EX_CHANNELS = [
  [1, 1, '제1수전 154kV', '수배전반', '수배전반', 1, '제1수전 인입', 1],
  [2, 1, '제2수전 154kV', '수배전반', '수배전반', 1, '제2수전 인입', 2],
  [3, 1, '주변압기 1 2차 22.9kV', '수배전반', '수배전반', 1, '주변압기 1', 3],
  [4, 1, '주변압기 2 2차 22.9kV', '수배전반', '수배전반', 1, '주변압기 2', 4],
  [5, 1, '냉동기 1호', '냉동기', '기계전기실', 2, '냉동기 1호', 1],
  [5, 2, '냉동기 2호', '냉동기', '기계전기실', 2, '냉동기 2호', 2],
  [5, 3, '공기압축기 1호', '공기압축기', '기계전기실', 2, '공기압축기 1호', 3],
  [5, 4, '기계전기실 통합', null, null, null, null, null],
  [6, 1, '사출기 라인 A', '사출기', '제조1동', 3, '사출기 라인 A', 1],
  [6, 2, '사출기 라인 B', '사출기', '제조1동', 3, '사출기 라인 B', 2],
  [6, 3, '제조1동 통합', null, null, null, null, null],
  [7, 1, '가스터빈 발전기 G1', '태양광', '발전설비', 4, '가스터빈 G1', 1],
  [8, 1, '옥상 태양광', '태양광', '발전설비', 4, '옥상 태양광', 2],
];

// [에너지원, 계통명, 계통ID, 레벨, 연결계통ID, 장비ID, 채널, 전압, 기기종류, 정격전류, 차단용량, 정격용량, 보호요소, 구역]
const EX_TREE = [
  [1, '제1수전 (RCP-1)', 1, 1, 0, 1, 1, 154, 'INCOMER', 1250, 50, 21000, '50/51,51N,67,87L', 'SUB'],
  [1, '주변압기 1', 2, 2, 1, 3, 1, 22.9, 'TR', 3150, null, 20000, '87T,49,64', 'SUB'],
  [1, '기계전기실 M/C', 3, 3, 2, 5, 4, 22.9, 'VCB', 1250, 25, 6000, '50/51,51G', 'MEP'],
  [1, '냉동기 1호', 4, 4, 3, 5, 1, 6.6, 'MOTOR', 400, null, 1200, '49,51', 'MEP'],
  [1, '냉동기 2호', 5, 4, 3, 5, 2, 6.6, 'MOTOR', 400, null, 1200, '49,51', 'MEP'],
  [1, '공기압축기 1호', 6, 4, 3, 5, 3, 6.6, 'MOTOR', 250, null, 750, '49,51', 'MEP'],
  [1, '제조1동 M/C', 7, 3, 2, 6, 3, 22.9, 'VCB', 1250, 25, 8000, '50/51,51G', 'FAB1'],
  [1, '사출기 라인 A', 8, 4, 7, 6, 1, 0.44, 'ACB', 2000, 65, 1600, '50/51,51N', 'FAB1'],
  [1, '사출기 라인 B', 9, 4, 7, 6, 2, 0.44, 'ACB', 2000, 65, 1600, '50/51,51N', 'FAB1'],
  [1, '제2수전 (RCP-2)', 10, 1, 0, 2, 1, 154, 'INCOMER', 1250, 50, 21000, '50/51,51N,67,87L', 'SUB'],
  [1, '주변압기 2', 11, 2, 10, 4, 1, 22.9, 'TR', 3150, null, 20000, '87T,49,64', 'SUB'],
  [1, '가스터빈 발전기 G1', 12, 3, 11, 7, 1, 3.3, 'GEN', 500, null, 2400, '32P,46,59,81', 'GEN'],
  [1, '옥상 태양광', 13, 3, 11, 8, 1, 0.44, 'PV', 1200, null, 800, '27,59,81', 'GEN'],
];

// [회선ID, 회선명, 공급변전소, 수전전압, 계약전력, 케이블규격, 운전구분, 연결계통ID]
const EX_INCOMERS = [
  [1, '제1수전 (RCP-1)', '평택 154kV 변전소', 154, 21000, '154kV CABLE 800SQ 1C×3', '상시', 1],
  [2, '제2수전 (RCP-2)', '평택 154kV 변전소', 154, 21000, '154kV CABLE 800SQ 1C×3', '상시/예비', 10],
];

// [TR ID, TR명, 연결계통ID, 1차, 2차, 용량kVA, 결선, %Z, 냉각, 권선장비, 권선채널, 유온장비, 유온채널]
const EX_TRANSFORMERS = [
  [1, '주변압기 1 (MTR-1)', 2, 154, 22.9, 20000, 'YNyn0', 13, 'ONAN', null, null, null, null],
  [2, '주변압기 2 (MTR-2)', 11, 154, 22.9, 20000, 'YNyn0', 13, 'ONAN', null, null, null, null],
];

// [구역코드, 구역명, 순서, 설명]
const EX_ZONES = [
  ['SUB', '변전동', 1, '154kV 수전 · 주변압기'],
  ['MEP', '기계전기실', 2, '냉동기 · 공기압축기 등 유틸리티'],
  ['FAB1', '제조1동', 3, '사출 라인'],
  ['GEN', '발전설비', 4, '가스터빈 · 태양광'],
];

/** 4)장비속성 — 제품별 연동 포인트 */
const EX_PROFILE = {
  'Accura 2300': [
    ['11106', '삼상의 상전압 평균', 'V', '상전압', '측정값', '평균', 0, 3, 7, 4, 'P'],
    ['11200+(150*x)+6', '삼상전류 평균', 'A', '전류', '측정값', '평균', 0, 3, 7, 4, 'O'],
    ['11200+(150*x)+66', '삼상의 유효전력 총합', 'kW', '유효전력', '측정값', '평균', 0, 3, 7, 4, 'N'],
    ['11200+(150*x)+74', '삼상의 무효전력 총합', 'kVAR', '무효전력', '측정값', '평균', 0, 3, 7, 4, 'Q'],
    ['11200+(150*x)+92', '삼상의 수전한 유효전력량', 'kWh', '유효전력량', '변화값', '합산', 0, 3, 3, 4, 'M'],
    ['11200+(150*x)+130', 'Total 역률', '%', '역률', '측정값', '평균', 100, 3, 7, 4, 'R'],
  ],
  MPM330a: [
    ['19', 'Total 유효전력', 'kW', '유효전력', '측정값', '평균', 0.001, 3, 10, 4, 'N'],
    ['27', '평균 역률', '%', '역률', '측정값', '평균', 0.01, 3, 10, 4, 'R'],
    ['29', '유효전력량', 'kWh', '유효전력량', '변화값', '합산', 0, 3, 10, 4, 'M'],
    ['62', '상전압 평균', 'V', '상전압', '측정값', '평균', 0.01, 3, 10, 4, 'P'],
    ['64', '상전류 평균', 'A', '전류', '측정값', '평균', 0.001, 3, 10, 4, 'O'],
  ],
};

// ══════════════════════════════════════════════════════════════════

function sheetGuide(wb) {
  const ws = wb.addWorksheet('읽어보기');
  ws.getColumn('A').width = 3;
  ws.getColumn('B').width = 30;
  ws.getColumn('C').width = 96;

  const lines = [
    ['H', 'FEMS 수용가 등록 양식'],
    ['P', '이 파일을 SCADA 도면 제작 화면에 올리면 단선결선도가 자동으로 만들어집니다.'],
    ['P', '노란 칸은 필수, 회색 칸은 선택입니다. 잘못된 값이 있으면 업로드 시 어느 시트 어느 셀인지 정확히 알려줍니다.'],
    ['S', '시트 구성'],
    ['T', `${S.SHEETS.BASIC}|수용가·요금제·계약전력·에너지원 계수`],
    ['T', `${S.SHEETS.DEVICE}|계측 장비(전력량계 등) 등록`],
    ['T', `${S.SHEETS.CHANNEL}|장비별 채널 → 측정부하 / 설비그룹`],
    ['T', `${S.SHEETS.ENERGY_TREE}|도면의 뼈대. 계통 계층 + 전압·기기종류·정격·보호요소`],
    ['T', `${S.SHEETS.DEVICE_PROFILE}|제품별 연동 포인트 정의`],
    ['T', `${S.SHEETS.CODE_RULE}|설비·에너지원·기기종류·보호요소 코드표`],
    ['T', `${S.SHEETS.TARIFF}|요금제 목록`],
    ['T', `${S.SHEETS.INCOMER}|한전 수전 회선 (선택) — 회선이 둘이면 두 줄`],
    ['T', `${S.SHEETS.TRANSFORMER}|변압기 제원 (선택)`],
    ['T', `${S.SHEETS.ZONE}|SCADA 화면 구역 (선택)`],
    ['S', '도면이 만들어지는 방식'],
    ['P', `${S.SHEETS.ENERGY_TREE} 의 계통레벨이 그대로 도면 계층이 됩니다.`],
    ['L', '레벨 1 (연결계통ID = 0) → 한전 수전점. 수전 회선이 둘이면 레벨 1 행을 두 개 넣으세요.'],
    ['L', '레벨 2 → 메인 모선에서 나가는 분기 (주변압기 · 배전반)'],
    ['L', '레벨 3 이하 → 개별 부하'],
    ['S', '전압·정격 입력 요령'],
    ['L', '전압은 kV 로 적습니다. 380V → 0.38, 22900V → 22.9, 154kV → 154'],
    ['L', '차단용량(kA)은 차단기(GCB/VCB/ACB/MCCB)에만 적습니다.'],
    ['L', '보호요소는 ANSI 기기번호를 쉼표로 나열합니다. 예) 50/51,51G,87T'],
    ['S', '자주 나오는 실수'],
    ['L', '양식의 예시 문구(홍길동 · 010-0000-0000 등)를 지우지 않고 제출'],
    ['L', '장비ID·계통ID 중복, 상위 계통 레벨과 어긋난 계통레벨'],
    ['L', `제품명이 ${S.SHEETS.DEVICE_PROFILE} 에 없는 경우 (계측 포인트를 만들 수 없습니다)`],
  ];

  let r = 2;
  for (const [kind, text] of lines) {
    if (kind === 'H') {
      ws.getCell(`B${r}`).value = text;
      ws.getCell(`B${r}`).font = { bold: true, size: 16 };
      r += 2;
    } else if (kind === 'S') {
      r++;
      ws.getCell(`B${r}`).value = text;
      ws.getCell(`B${r}`).font = { bold: true, size: 12, color: { argb: C.head } };
      r++;
    } else if (kind === 'T') {
      const [name, desc] = text.split('|');
      ws.getCell(`B${r}`).value = name;
      ws.getCell(`B${r}`).font = { size: 10, bold: true };
      ws.getCell(`C${r}`).value = desc;
      ws.getCell(`C${r}`).font = { size: 10, color: { argb: C.note } };
      r++;
    } else if (kind === 'L') {
      ws.getCell(`C${r}`).value = '· ' + text;
      ws.getCell(`C${r}`).font = { size: 10, color: { argb: C.note } };
      r++;
    } else {
      ws.getCell(`C${r}`).value = text;
      ws.getCell(`C${r}`).font = { size: 10 };
      r++;
    }
  }
  return ws;
}

function sheetBasic(wb, example) {
  const ws = wb.addWorksheet(S.SHEETS.BASIC);
  ws.getColumn('A').width = 18;
  ws.getColumn('B').width = 28;
  for (const c of ['C', 'D', 'E', 'F']) ws.getColumn(c).width = 22;
  ws.getColumn('G').width = 12;

  ws.getCell('A1').value = 'FEMS 수용가 정보';
  ws.getCell('A1').font = { bold: true, size: 13 };

  const labels = [
    ['A2', '회사정보'], ['B2', '* 회사명'], ['B3', '업종'], ['B4', '홈페이지 주소'],
    ['B5', '* 전화번호'], ['B6', '* 주소'],
    ['A7', '신청정보'], ['B7', '* FEMS 마스터 계정ID'], ['B8', '* 공장코드(접속주소)'], ['B9', '* 신청 요금제'],
    ['A10', '한전파워플래너'], ['B10', '계정'], ['B11', '비밀번호'],
    ['A12', '수용가 담당자 정보'], ['B12', '* 담당자명'], ['B13', '직급'], ['B14', '* 휴대전화번호'], ['B15', '* 이메일 주소'],
    ['A16', '기타'], ['B16', '에너지원'], ['B18', '건물규모'], ['B20', '준공년도'], ['B21', '상주인력'],
    ['B22', '연평균 에너지 사용량'], ['B23', '일 평균 운영시간'],
    ['A24', 'FEMS 설정'], ['B24', '* 요금 적용 전력'], ['B25', '* 수전용량'],
    ['A27', '에너지 정보'], ['B27', '종류'], ['B28', '에너지원 기본 단위'], ['B29', '탭표시명'],
    ['B30', '석유환산계수[toe/기본단위]'], ['B31', '탄소배출계수 [tco2/기본단위]'], ['B32', '에너지 단가 [원/기본단위]'],
  ];
  for (const [cell, v] of labels) {
    ws.getCell(cell).value = v;
    ws.getCell(cell).font = { bold: /^A/.test(cell), size: 10 };
    if (/^A/.test(cell)) ws.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.section } };
  }

  ws.getCell('C16').value = '전기'; ws.getCell('D16').value = '가스';
  ws.getCell('E16').value = 'LPG'; ws.getCell('F16').value = '기타';
  ws.getCell('C18').value = '동'; ws.getCell('D18').value = '존';
  ws.getCell('E18').value = '층'; ws.getCell('F18').value = '연면적';
  ws.getCell('G20').value = '년'; ws.getCell('G21').value = '명';
  ws.getCell('G22').value = 'toe'; ws.getCell('G23').value = 'hour/day';
  ws.getCell('G24').value = 'kW'; ws.getCell('G25').value = 'kW';

  // 입력칸 서식
  for (const f of S.BASIC_FIELDS) styleInput(ws.getCell(f.cell), !!f.required);
  for (const col of ['C', 'D', 'E', 'F']) {
    for (const r of [17, 19, 27, 28, 29, 30, 31, 32]) styleInput(ws.getCell(`${col}${r}`), r === 27);
  }

  if (example) for (const [cell, v] of Object.entries(EX_BASIC)) ws.getCell(cell).value = v;
  return ws;
}

function sheetDeviceProfile(wb, example) {
  const ws = wb.addWorksheet(S.SHEETS.DEVICE_PROFILE);
  const spec = S.DEVICE_PROFILE_SHEET;

  ws.getCell('A1').value = '장비별 연동 포인트';
  ws.getCell('A1').font = { bold: true, size: 12 };
  ws.getCell('M1').value = '에너지트리 매핑정보';
  ws.getCell('U1').value = '설비트리 매핑정보';
  for (const c of ['M1', 'U1']) ws.getCell(c).font = { bold: true, size: 10 };
  ws.getCell('A2').value = '계측기 및 연동장비';
  ws.getCell('B2').value = '제품명';
  ws.getCell('C2').value = '연동요청';
  ws.getCell('E2').value = '단위';
  ws.getCell('F2').value = 'FEMS 등록정보';

  for (const c of spec.columns) {
    styleHeader(ws.getCell(`${c.col}${spec.headerRow}`), c.label, !!c.required);
    ws.getColumn(c.col).width = Math.max(11, Math.min(24, String(c.label).length * 1.9 + 4));
  }
  for (const r of codes.POINT_ROLES) {
    styleHeader(ws.getCell(`${r.col}${spec.headerRow}`), r.label, false);
    ws.getColumn(r.col).width = 10;
  }
  ws.views = [{ state: 'frozen', ySplit: spec.headerRow }];

  let row = spec.startRow;
  if (example) {
    for (const [product, points] of Object.entries(EX_PROFILE)) {
      points.forEach((p, i) => {
        if (i === 0) {
          ws.getCell(`A${row}`).value = '전력량계';
          ws.getCell(`B${row}`).value = product;
        }
        const [address, src, unit, name, mtype, stype, scale, fn, pt, ps, mapCol] = p;
        ws.getCell(`C${row}`).value = address;
        ws.getCell(`D${row}`).value = src;
        ws.getCell(`E${row}`).value = unit;
        ws.getCell(`F${row}`).value = name;
        ws.getCell(`G${row}`).value = mtype;
        ws.getCell(`H${row}`).value = stype;
        ws.getCell(`I${row}`).value = scale;
        ws.getCell(`J${row}`).value = fn;
        ws.getCell(`K${row}`).value = pt;
        ws.getCell(`L${row}`).value = ps;
        if (mapCol) ws.getCell(`${mapCol}${row}`).value = 'O';
        if (mapCol === 'M') ws.getCell(`U${row}`).value = 'O';
        row++;
      });
    }
  }
  for (let r = row; r < row + 25; r++) {
    for (const c of spec.columns) styleInput(ws.getCell(`${c.col}${r}`), !!c.required);
  }
  return ws;
}

function sheetCodeRule(wb) {
  const ws = wb.addWorksheet(S.SHEETS.CODE_RULE);
  ws.getCell('A1').value = '코드 규칙 — 아래 값 중 하나를 그대로 입력하세요';
  ws.getCell('A1').font = { bold: true, size: 12 };

  ws.getCell('B3').value = '구분';
  ws.getCell('F3').value = '장비타입';
  ws.getCell('F4').value = '입력코드';
  ws.getCell('G4').value = '에너지원';
  for (const c of ['B3', 'F3', 'F4', 'G4']) {
    ws.getCell(c).font = { bold: true, size: 10 };
    ws.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.section } };
  }
  ws.getCell('A1').alignment = { vertical: 'middle' };
  ws.getColumn('B').width = 20;
  ws.getColumn('F').width = 14;
  ws.getColumn('G').width = 22;

  codes.EQUIPMENT_CODES.forEach((c, i) => (ws.getCell(`B${i + 4}`).value = c));
  codes.ENERGY_SOURCE_CODES.forEach((e, i) => {
    ws.getCell(`F${i + 5}`).value = e.code;
    ws.getCell(`G${i + 5}`).value = e.name;
  });

  // v2 코드표 — 기기종류 / 보호요소
  ws.getCell('I3').value = '기기종류 (3)에너지트리 I열)';
  ws.getCell('I4').value = '코드';
  ws.getCell('J4').value = '명칭';
  ws.getCell('K4').value = '분류';
  ws.getCell('M3').value = '보호요소 (3)에너지트리 M열, ANSI 기기번호)';
  ws.getCell('M4').value = '코드';
  ws.getCell('N4').value = '명칭';
  for (const c of ['I3', 'I4', 'J4', 'K4', 'M3', 'M4', 'N4']) {
    ws.getCell(c).font = { bold: true, size: 10 };
    ws.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.section } };
  }
  ws.getColumn('I').width = 12;
  ws.getColumn('J').width = 20;
  ws.getColumn('K').width = 12;
  ws.getColumn('M').width = 12;
  ws.getColumn('N').width = 20;

  codes.DEVICE_KINDS.forEach((d, i) => {
    ws.getCell(`I${i + 5}`).value = d.code;
    ws.getCell(`J${i + 5}`).value = d.name;
    ws.getCell(`K${i + 5}`).value = d.group;
  });
  codes.PROTECTION_CODES.forEach((pc, i) => {
    ws.getCell(`M${i + 5}`).value = pc.code;
    ws.getCell(`N${i + 5}`).value = pc.name;
  });

  // 참고 — 표준 전압 / 결선 / 냉각
  ws.getCell('P3').value = '참고 표기';
  ws.getCell('P3').font = { bold: true, size: 10 };
  ws.getColumn('P').width = 16;
  ws.getColumn('Q').width = 54;
  const refs = [
    ['표준 전압(kV)', codes.VOLTAGE_LEVELS.join(' / ')],
    ['변압기 결선', codes.VECTOR_GROUPS.join(' / ')],
    ['냉각방식', codes.COOLING_TYPES.join(' / ')],
    ['운전구분', codes.FEED_MODES.join(' / ')],
    ['계측유형', codes.MEASURE_TYPES.join(' / ')],
    ['통계유형', codes.STAT_TYPES.join(' / ')],
  ];
  refs.forEach(([k, v], i) => {
    ws.getCell(`P${i + 5}`).value = k;
    ws.getCell(`P${i + 5}`).font = { size: 9, bold: true };
    ws.getCell(`Q${i + 5}`).value = v;
    ws.getCell(`Q${i + 5}`).font = { size: 9, color: { argb: C.note } };
  });
  return ws;
}

/**
 * 양식 워크북 생성
 * @param {object} opts { mode: 'example'|'blank' }
 */
async function buildTemplate(opts = {}) {
  const example = opts.mode !== 'blank';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FEMS SCADA 도면 제작';
  wb.created = new Date(Date.UTC(2026, 0, 1));
  wb.modified = wb.created;

  sheetGuide(wb);
  sheetBasic(wb, example);

  // 1)장비
  const dv = wb.addWorksheet(S.SHEETS.DEVICE);
  layoutTable(dv, S.DEVICE_SHEET, '등록 장비 정보');
  writeGuide(dv, S.DEVICE_SHEET, [
    ['장비ID', '1번부터 중복 없이 부여합니다.'],
    ['제품명', `${S.SHEETS.DEVICE_PROFILE} 시트에 정의된 제품명과 같아야 합니다.`],
    ['IP 주소', 'IPv4 형식. 예) 10.10.1.11'],
    ['고정값', '프로토콜 타입~사용여부는 예시와 동일하게 두세요 (필요 시 변경).'],
  ], 'T');
  if (example) {
    fillRows(dv, S.DEVICE_SHEET, EX_DEVICES.map((d) => ({
      deviceId: d[0], deviceType: d[1], productName: d[2], measuredFacility: d[3],
      location: d[4], ip: d[5], installedAt: new Date(Date.UTC(2026, 2, 10, 9, 0)),
      protocolType: '01', engineId: 1, offset: 0, port: 502,
      sendCycle: 15, monitorCycle: 15, powerChannels: 40, calcYn: 'Y', useYn: 'Y',
    })));
  }

  // 2)채널활성화
  const ch = wb.addWorksheet(S.SHEETS.CHANNEL);
  layoutTable(ch, S.CHANNEL_SHEET, '채널정보 / 설비 트리 연동');
  writeGuide(ch, S.CHANNEL_SHEET, [
    ['채널정보', '장비ID별 1번부터 순번을 부여합니다.'],
    ['설비코드정보', `${S.SHEETS.CODE_RULE} 시트의 설비코드 중 하나.`],
    ['설비트리 5개 열', '함께 입력하거나 모두 비웁니다. 통합(합계) 채널은 모두 비웁니다.'],
    ['설비그룹ID', '같은 설비그룹명에는 항상 같은 ID 를 씁니다.'],
  ], 'K');
  if (example) {
    fillRows(ch, S.CHANNEL_SHEET, EX_CHANNELS.map((c) => ({
      deviceId: c[0], channel: c[1], loadName: c[2], equipmentCode: c[3],
      groupName: c[4], groupId: c[5], facilityName: c[6], facilityId: c[7],
    })));
  }

  // 3)에너지트리 (v2 확장 포함)
  const et = wb.addWorksheet(S.SHEETS.ENERGY_TREE);
  layoutTable(et, S.ENERGY_TREE_SHEET, '에너지 계통 트리 — 이 시트가 도면의 뼈대입니다');
  writeGuide(et, S.ENERGY_TREE_SHEET, [
    ['계통레벨', '1 = 한전 수전점. 수전 회선이 둘이면 레벨 1 행을 두 개 넣습니다.'],
    ['연결계통ID', '레벨 1은 0. 레벨 2 이상은 상위 계통의 "에너지계통 ID".'],
    ['전압(kV)', 'kV 단위. 380V → 0.38, 22900V → 22.9, 154kV → 154'],
    ['기기종류', `${S.SHEETS.CODE_RULE} 의 기기종류 코드 (VCB · ACB · TR · GEN · PV …).`],
    ['차단용량(kA)', '차단기(GCB/VCB/ACB/MCCB)에만 입력합니다.'],
    ['보호요소', 'ANSI 기기번호를 쉼표로. 예) 50/51,51G,87T'],
    ['구역코드', `${S.SHEETS.ZONE} 시트의 구역코드. 도면을 구역별로 나눠 볼 때 씁니다.`],
    ['장비ID·채널정보', `${S.SHEETS.CHANNEL} 에 등록된 조합이어야 실시간 값이 붙습니다.`],
  ], 'Q');
  if (example) {
    fillRows(et, S.ENERGY_TREE_SHEET, EX_TREE.map((t) => ({
      energySource: t[0], systemName: t[1], systemId: t[2], level: t[3], parentId: t[4],
      deviceId: t[5], channel: t[6], voltage: t[7], deviceKind: t[8],
      ratedCurrent: t[9], breakingCapacity: t[10], ratedPower: t[11],
      protection: t[12], zoneCode: t[13],
    })));
  }

  sheetDeviceProfile(wb, example);
  sheetCodeRule(wb);

  // 6)요금제목록
  const tf = wb.addWorksheet(S.SHEETS.TARIFF);
  tf.getColumn('A').width = 44;
  codes.TARIFFS.forEach((t, i) => (tf.getCell(`A${i + 1}`).value = t));

  // 7)수전계통
  const inc = wb.addWorksheet(S.SHEETS.INCOMER);
  layoutTable(inc, S.INCOMER_SHEET, '한전 수전 계통 — 회선마다 한 줄 (선택 시트)', 12);
  writeGuide(inc, S.INCOMER_SHEET, [
    ['회선', '수전 회선이 둘이면 두 줄을 적습니다. (RCP-1 / RCP-2 처럼)'],
    ['연결계통ID', `${S.SHEETS.ENERGY_TREE} 의 레벨 1 계통 ID 를 적습니다.`],
    ['운전구분', codes.FEED_MODES.join(' / ')],
    ['비고', '이 시트가 없어도 도면은 만들어집니다. 적으면 수전 카드에 회선 정보가 함께 표시됩니다.'],
  ], 'J');
  if (example) {
    fillRows(inc, S.INCOMER_SHEET, EX_INCOMERS.map((x) => ({
      lineId: x[0], lineName: x[1], substation: x[2], voltage: x[3],
      contractPower: x[4], cableSpec: x[5], feedMode: x[6], systemId: x[7],
    })));
  }

  // 8)변압기
  const tr = wb.addWorksheet(S.SHEETS.TRANSFORMER);
  layoutTable(tr, S.TRANSFORMER_SHEET, '변압기 제원 (선택 시트)', 14);
  writeGuide(tr, S.TRANSFORMER_SHEET, [
    ['연결계통ID', `${S.SHEETS.ENERGY_TREE} 에서 이 변압기에 해당하는 계통 ID.`],
    ['용량', 'kVA 로 적습니다. 20MVA → 20000'],
    ['결선', codes.VECTOR_GROUPS.slice(0, 6).join(' / ') + ' …'],
    ['냉각방식', codes.COOLING_TYPES.join(' / ')],
    ['온도 감시', `권선온도·유온을 계측 중이면 ${S.SHEETS.CHANNEL} 의 장비ID·채널을 적습니다.`],
  ], 'O');
  if (example) {
    fillRows(tr, S.TRANSFORMER_SHEET, EX_TRANSFORMERS.map((x) => ({
      trId: x[0], name: x[1], systemId: x[2], primaryVoltage: x[3], secondaryVoltage: x[4],
      capacity: x[5], vectorGroup: x[6], impedance: x[7], cooling: x[8],
      windingTempDevice: x[9], windingTempChannel: x[10], oilTempDevice: x[11], oilTempChannel: x[12],
    })));
  }

  // 9)구역
  const zn = wb.addWorksheet(S.SHEETS.ZONE);
  layoutTable(zn, S.ZONE_SHEET, 'SCADA 화면 구역 (선택 시트)', 14);
  writeGuide(zn, S.ZONE_SHEET, [
    ['구역코드', '영문/숫자 짧은 코드. 예) SUB, MEP, FAB1'],
    ['구역명', '화면에 표시할 이름. 예) 변전동, 기계전기실'],
    ['표시순서', '작은 번호부터 표시합니다.'],
    ['비고', `${S.SHEETS.ENERGY_TREE} 의 구역코드 열과 연결됩니다.`],
  ], 'F');
  if (example) {
    fillRows(zn, S.ZONE_SHEET, EX_ZONES.map((z) => ({ zoneCode: z[0], zoneName: z[1], order: z[2], note: z[3] })));
  }

  return wb;
}

/**
 * 양식 → xlsx 버퍼.
 * 빌드 산출물에 embed 되므로 실행 시각과 무관하게 항상 같은 바이트가 나와야 한다.
 */
async function templateBuffer(opts) {
  const wb = await buildTemplate(opts);
  return normalizeZipTimestamps(await wb.xlsx.writeBuffer());
}

module.exports = { buildTemplate, templateBuffer, EX_TREE, EX_INCOMERS, EX_TRANSFORMERS, EX_ZONES };
