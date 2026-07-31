'use strict';

/**
 * 테스트/데모용 「FEMS 수용가 등록 엑셀」 생성기.
 *
 * 실제 양식과 **동일한 시트/셀 배치**로 만든다. 두 가지를 만들어낸다.
 *   sample-good.xlsx   : 오류 0건. 한전메인 2개(제2수전) 구성 포함.
 *   sample-broken.xlsx : 일부러 셀 단위 오류를 심어둔 파일 (검증기 회귀 테스트용)
 *
 * 실행: node test/make-sample.js [출력디렉터리]
 */

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const codes = require('../server/scada/codes');
const { normalizeZipTimestamps } = require('../server/scada/zip-normalize');

const HEAD = { bold: true };

function setBasic(ws, o) {
  ws.getCell('A1').value = 'FEMS 수용가 정보';
  const labels = [
    ['A2', '회사정보'], ['B2', '* 회사명'], ['B3', '업종'], ['B4', '홈페이지 주소'],
    ['B5', '* 전화번호'], ['B6', '* 주소'],
    ['A7', '신청정보'], ['B7', ' * FEMS 마스터 계정ID'], ['B8', '* 공장코드(접속주소)'], ['B9', '* 신청 요금제'],
    ['A10', '한전파워플래너'], ['B10', '계정'], ['B11', '비밀번호'],
    ['A12', '수용가 담당자 정보'], ['B12', '*  담당자명'], ['B13', '직급'], ['B14', '* 휴대전화번호'], ['B15', '* 이메일 주소'],
    ['A16', '기타'], ['B16', '에너지원'], ['B18', '건물규모'], ['B20', '준공년도'], ['B21', '상주인력'],
    ['B22', '연편균 에너지 사용량'], ['B23', '일 평균 운영시간'],
    ['A24', 'FEMS 설정'], ['B24', '*요금 적용 전력'], ['B25', '*수전용량'],
    ['A27', '에너지 정보'], ['B27', '종류'], ['B28', '에너지원 기본 단위'], ['B29', '탭표시명'],
    ['B30', '석유환산계수[toe/기본단위]'], ['B31', '탄소배출계수 [tco2/기본단위]'], ['B32', '에너지 단가 [원/기본단위]'],
  ];
  for (const [cell, v] of labels) ws.getCell(cell).value = v;

  ws.getCell('C16').value = '전기';
  ws.getCell('D16').value = '가스';
  ws.getCell('C18').value = '동';
  ws.getCell('D18').value = '존';
  ws.getCell('E18').value = '층';
  ws.getCell('F18').value = '연면적';
  ws.getCell('G20').value = '년';
  ws.getCell('G24').value = 'kW';
  ws.getCell('G25').value = 'kW';

  for (const [cell, v] of Object.entries(o)) ws.getCell(cell).value = v;
}

const GOOD_BASIC = {
  C2: '한빛정밀공업',
  C3: '자동차부품제조업',
  C4: 'http://www.hanbit-example.co.kr/',
  C5: '031-555-1234',
  C6: '경기도 안성시 공단로 24',
  C7: 'hanbit',
  C8: 'hanbit',
  C9: '산업용전력(을) - 고압 A - 선택 Ⅱ',
  C10: '0123456789',
  C11: 'kepco-pw-2024',
  C12: '이창범',
  C13: '차장',
  C14: '010-2345-6789',
  C15: 'cb.lee@hanbit-example.co.kr',
  C19: 2, D19: 3, E19: 4, F19: 12800,
  C20: 2011,
  C21: 145,
  C22: 1820,
  C23: 20,
  C24: 2400,
  C25: 3000,
  C27: '전기', C28: 'kWh', C29: '전력', C30: 0.00023, C31: 0.0004594, C32: 148.5,
};

// 장비: 1=제1수전 메인, 2=제2수전 메인, 3=압출기, 4=공압기, 5=사출기
const DEVICES = [
  [1, '전력량계', 'Accura 2300', '제1수전 한전메인 배전반', '1공장 전기실', '100.100.0.11'],
  [2, '전력량계', 'Accura 2300', '제2수전 한전메인 배전반', '2공장 전기실', '100.100.0.12'],
  [3, '전력량계', 'Accura 2300', '압출기', '1공장', '100.100.0.13'],
  [4, '전력량계', 'MPM330a', '공압기', '1공장 유틸리티동', '100.100.0.14'],
  [5, '전력량계', 'Accura 2300', '사출기', '2공장', '100.100.0.15'],
];

// [장비ID, 채널, 측정부하명, 설비코드, 설비그룹명, 설비그룹ID, 설비명, 설비ID]
const CHANNELS = [
  [1, 1, '제1수전 한전메인', '수배전반', '수배전반', 1, '제1수전 메인', 1],
  [2, 1, '제2수전 한전메인', '수배전반', '수배전반', 1, '제2수전 메인', 2],
  [3, 1, '압출기1호', '압출기', '압출기', 2, '압출기1호', 1],
  [3, 2, '압출기2호', '압출기', '압출기', 2, '압출기2호', 2],
  [3, 3, '압출기 1~2호 통합', null, null, null, null, null],
  [4, 1, '공압기1호', '공기압축기', 'A동 공압기', 3, '공압기1호', 1],
  [4, 2, '공압기2호', '공기압축기', 'A동 공압기', 3, '공압기2호', 2],
  [4, 3, '공압기3호', '공기압축기', 'A동 공압기', 3, '공압기3호', 3],
  [4, 4, '공압기 1~3호 통합', null, null, null, null, null],
  [5, 1, '사출기1호', '사출기', '사출기', 4, '사출기1호', 1],
  [5, 2, '사출기2호', '사출기', '사출기', 4, '사출기2호', 2],
  [5, 3, '사출기3호', '사출기', '사출기', 4, '사출기3호', 3],
  [5, 4, '사출기4호', '사출기', '사출기', 4, '사출기4호', 4],
  [5, 5, '사출기 1~4호 통합', null, null, null, null, null],
];

// [에너지원, 계통명, 계통ID, 레벨, 연결계통ID, 장비ID, 채널]
const ENERGY_TREE = [
  [1, '제1수전 한전메인', 1, 1, 0, 1, 1],
  [1, '압출기', 2, 2, 1, 3, 3],
  [1, '압출기 1호기', 3, 3, 2, 3, 1],
  [1, '압출기 2호기', 4, 3, 2, 3, 2],
  [1, '공기압축기', 5, 2, 1, 4, 4],
  [1, '공기압축기 1호기', 6, 3, 5, 4, 1],
  [1, '공기압축기 2호기', 7, 3, 5, 4, 2],
  [1, '공기압축기 3호기', 8, 3, 5, 4, 3],
  // 제2수전 — 한 업체에 한전메인이 둘인 구성
  [1, '제2수전 한전메인', 9, 1, 0, 2, 1],
  [1, '사출기', 10, 2, 9, 5, 5],
  [1, '사출기 1호기', 11, 3, 10, 5, 1],
  [1, '사출기 2호기', 12, 3, 10, 5, 2],
  [1, '사출기 3호기', 13, 3, 10, 5, 3],
  [1, '사출기 4호기', 14, 3, 10, 5, 4],
];

/** 4)장비속성 — [제품명, Address, 포인트정보, 단위, 포인트명, 계측유형, 통계유형, 배율, Func, Type, Size, 매핑열] */
const PROFILE = {
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

async function build(outPath, mutate) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FEMS SCADA Diagram Generator';

  // 0)기본정보
  setBasic(wb.addWorksheet('0)기본정보'), GOOD_BASIC);

  // 1)장비
  const dv = wb.addWorksheet('1)장비');
  dv.getCell('A1').value = '등록 장비 정보';
  ['*장비ID', '*장비 타입', '* 제품명', '측정설비', '장비 위치', '*IP 주소', '설치 일자'].forEach((h, i) => {
    dv.getCell(2, i + 1).value = h;
    dv.getCell(2, i + 1).font = HEAD;
  });
  ['프로토콜 타입', '엔진 ID', 'Offset', '포트', '전송주기', '모니터링 주기', '전력 채널 수', '계산 여부', '사용여부'].forEach((h, i) => {
    dv.getCell(2, i + 9).value = h;
    dv.getCell(2, i + 9).font = HEAD;
  });
  DEVICES.forEach((d, i) => {
    const r = i + 3;
    d.forEach((v, c) => (dv.getCell(r, c + 1).value = v));
    dv.getCell(r, 7).value = new Date('2023-04-18T09:20:00Z');
    ['01', 1, 0, 502, 15, 15, 40, 'Y', 'Y'].forEach((v, c) => (dv.getCell(r, c + 9).value = v));
  });

  // 2)채널활성화 및 설비트리
  const ch = wb.addWorksheet('2)채널활성화 및 설비트리');
  ch.getCell('A1').value = '채널정보';
  ch.getCell('D1').value = '설비 트리 연동';
  ['*장비ID', '채널정보', '측정부하명', '설비코드정보', '설비그룹명', '설비그룹ID', '설비명', '설비ID'].forEach((h, i) => {
    ch.getCell(2, i + 1).value = h;
    ch.getCell(2, i + 1).font = HEAD;
  });
  CHANNELS.forEach((row, i) => row.forEach((v, c) => (ch.getCell(i + 3, c + 1).value = v)));

  // 3)에너지트리
  const et = wb.addWorksheet('3)에너지트리');
  et.getCell('A1').value = '에너지트리정보';
  et.getCell('F1').value = '에너지 포인트연동';
  ['*에너지원', '* 계통명', '*에너지계통 ID', '계통레벨', '연결계통ID', '장비ID', '채널정보'].forEach((h, i) => {
    et.getCell(2, i + 1).value = h;
    et.getCell(2, i + 1).font = HEAD;
  });
  ENERGY_TREE.forEach((row, i) => row.forEach((v, c) => (et.getCell(i + 3, c + 1).value = v)));

  // 4)장비속성
  const dp = wb.addWorksheet('4) 장비속성');
  dp.getCell('A1').value = '장비별 연동 포인트';
  dp.getCell('M1').value = '에너지트리 매핑정보';
  dp.getCell('U1').value = '설비트리 매핑정보';
  dp.getCell('A2').value = '계측기 및 연동장비';
  dp.getCell('B2').value = '제품명';
  dp.getCell('C2').value = '연동요청';
  dp.getCell('E2').value = '단위';
  dp.getCell('F2').value = 'FEMS 등록정보';
  ['', '', 'Address', '포인트정보', '', '포인트명', '계측유형', '통계유형', '배율', 'Func Code', 'Point Type', 'Point Size'].forEach(
    (h, i) => h && (dp.getCell(3, i + 1).value = h)
  );
  codes.POINT_ROLES.forEach((r) => (dp.getCell(`${r.col}3`).value = r.label));

  let row = 4;
  for (const [product, points] of Object.entries(PROFILE)) {
    points.forEach((p, i) => {
      if (i === 0) {
        dp.getCell(`A${row}`).value = '전력량계';
        dp.getCell(`B${row}`).value = product;
      }
      const [address, src, unit, name, mtype, stype, scale, fn, pt, ps, mapCol] = p;
      dp.getCell(`C${row}`).value = address;
      dp.getCell(`D${row}`).value = src;
      dp.getCell(`E${row}`).value = unit;
      dp.getCell(`F${row}`).value = name;
      dp.getCell(`G${row}`).value = mtype;
      dp.getCell(`H${row}`).value = stype;
      dp.getCell(`I${row}`).value = scale;
      dp.getCell(`J${row}`).value = fn;
      dp.getCell(`K${row}`).value = pt;
      dp.getCell(`L${row}`).value = ps;
      if (mapCol) dp.getCell(`${mapCol}${row}`).value = 'O';
      if (mapCol === 'M') dp.getCell(`U${row}`).value = 'O';
      row++;
    });
  }

  // 5)코드규칙
  const cr = wb.addWorksheet('5) 코드규칙');
  cr.getCell('A1').value = '설비코드규칙';
  cr.getCell('E1').value = '에너지원 코드규칙';
  cr.getCell('B3').value = '구분';
  cr.getCell('F3').value = '장비타입';
  cr.getCell('F4').value = '입력코드';
  cr.getCell('G4').value = '에너지원';
  codes.EQUIPMENT_CODES.forEach((c, i) => (cr.getCell(`B${i + 4}`).value = c));
  codes.ENERGY_SOURCE_CODES.forEach((e, i) => {
    cr.getCell(`F${i + 5}`).value = e.code;
    cr.getCell(`G${i + 5}`).value = e.name;
  });

  // 6)요금제목록
  const tf = wb.addWorksheet('6) 요금제목록');
  codes.TARIFFS.forEach((t, i) => (tf.getCell(`A${i + 1}`).value = t));

  if (mutate) mutate(wb);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // 실행 시각이 바이트에 섞이지 않도록 ZIP 타임스탬프를 고정한 뒤 쓴다
  wb.created = new Date(Date.UTC(2026, 0, 1));
  wb.modified = wb.created;
  fs.writeFileSync(outPath, normalizeZipTimestamps(await wb.xlsx.writeBuffer()));
  return outPath;
}

/** 일부러 셀 단위 오류를 심는다. 각 주석은 "검증기가 짚어야 할 셀"이다. */
function breakIt(wb) {
  wb.getWorksheet('0)기본정보').getCell('C15').value = 'not-an-email';        // BAD_EMAIL
  wb.getWorksheet('0)기본정보').getCell('C9').value = '산업용전력(을) - 고압 A - 선택 5'; // UNKNOWN_TARIFF
  wb.getWorksheet('0)기본정보').getCell('C24').value = 4000;                   // CONTRACT_GT_CAPACITY (경고)
  wb.getWorksheet('1)장비').getCell('F5').value = '100.100.0.999';             // BAD_IP
  wb.getWorksheet('1)장비').getCell('A6').value = 3;                           // DUPLICATE_ID (A5 와 충돌)
  wb.getWorksheet('1)장비').getCell('C7').value = 'Accura9999';                // UNKNOWN_PRODUCT
  wb.getWorksheet('2)채널활성화 및 설비트리').getCell('A5').value = 99;         // UNKNOWN_DEVICE
  wb.getWorksheet('2)채널활성화 및 설비트리').getCell('D8').value = '공기압축';  // UNKNOWN_EQUIPMENT_CODE (오타)
  wb.getWorksheet('2)채널활성화 및 설비트리').getCell('F9').value = 77;          // GROUP_ID_CONFLICT
  wb.getWorksheet('3)에너지트리').getCell('E4').value = 999;                    // UNKNOWN_PARENT
  wb.getWorksheet('3)에너지트리').getCell('D6').value = 4;                      // LEVEL_MISMATCH
  wb.getWorksheet('3)에너지트리').getCell('C8').value = 5;                      // DUPLICATE_SYSTEM_ID
  wb.getWorksheet('3)에너지트리').getCell('G12').value = 88;                    // UNKNOWN_CHANNEL_MAPPING
}

async function main() {
  const outDir = process.argv[2] || path.join(__dirname, 'fixtures');
  const good = await build(path.join(outDir, 'sample-good.xlsx'));
  const broken = await build(path.join(outDir, 'sample-broken.xlsx'), breakIt);
  console.log('생성 완료:\n  ' + good + '\n  ' + broken);
}

if (require.main === module) main();

module.exports = { build, breakIt };
