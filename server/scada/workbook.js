'use strict';

const ExcelJS = require('exceljs');

/**
 * 엑셀 접근 헬퍼.
 *
 * 이 파일의 존재 이유는 단 하나 — **모든 값이 "어느 시트 어느 셀에서 왔는지"를
 * 항상 함께 들고 다니게** 하는 것이다. 검증기가 오류를 낼 때 `C12` 처럼
 * 정확한 셀을 짚어줄 수 있어야 하기 때문이다.
 */

/** 시트 이름은 공백/괄호 표기 흔들림이 잦아 정규화 후 매칭한다. ('1)장비' vs '1) 장비') */
function normalizeSheetName(name) {
  return String(name || '').replace(/\s/g, '').toLowerCase();
}

function colToNumber(col) {
  let n = 0;
  for (const ch of String(col).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function numberToCol(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** exceljs 셀 값 → 순수 스칼라. 수식/리치텍스트/하이퍼링크를 표시값으로 평탄화한다. */
function cellValue(cell) {
  if (!cell) return null;
  let v = cell.value;
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if (Array.isArray(v.richText)) v = v.richText.map((t) => t.text).join('');
    else if ('text' in v && 'hyperlink' in v) v = v.text;
    else if ('result' in v) v = v.result;
    else if ('formula' in v) v = null;
    else if ('error' in v) return { __error: v.error };
  }
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v;
}

class Sheet {
  constructor(ws, declaredName) {
    this.ws = ws;
    this.name = declaredName || (ws && ws.name) || '';
    this.exists = !!ws;
  }

  /** @returns {{value:*, cell:string, row:number, col:string}} — 값이 없어도 셀 주소는 항상 반환 */
  at(col, row) {
    const address = `${col}${row}`;
    const value = this.exists ? cellValue(this.ws.getCell(address)) : null;
    return { value, cell: address, row, col, sheet: this.name };
  }

  get lastRow() {
    return this.exists ? this.ws.actualRowCount ? this.ws.rowCount : 0 : 0;
  }

  /**
   * 데이터 행을 훑는다. `identityCols` 중 하나라도 값이 있어야 "입력된 행"으로 본다.
   *
   * 양식에는 고정값(프로토콜 타입·포트 등)만 미리 채워진 빈 템플릿 행이 수십 줄 딸려온다.
   * 그 행들을 오류로 쏟아내지 않으려면 식별 컬럼 기준으로 판정해야 한다.
   */
  *dataRows(startRow, identityCols, maxRow) {
    if (!this.exists) return;
    const end = maxRow || this.ws.rowCount || startRow;
    for (let r = startRow; r <= end; r++) {
      const filled = identityCols.some((c) => this.at(c, r).value != null);
      if (filled) yield r;
    }
  }

  /** 세로로 이어지는 목록 열 (5)코드규칙, 6)요금제목록 처럼 한 열만 읽을 때) */
  columnList(col, startRow, endRow) {
    const out = [];
    if (!this.exists) return out;
    for (let r = startRow; r <= endRow; r++) {
      const v = this.at(col, r).value;
      if (v != null) out.push({ value: String(v).trim(), row: r, cell: `${col}${r}` });
    }
    return out;
  }
}

class Workbook {
  constructor(wb) {
    this.wb = wb;
    this.index = new Map();
    for (const ws of wb.worksheets) this.index.set(normalizeSheetName(ws.name), ws);
  }

  static async fromBuffer(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    return new Workbook(wb);
  }

  static async fromFile(path) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    return new Workbook(wb);
  }

  get sheetNames() {
    return this.wb.worksheets.map((w) => w.name);
  }

  /**
   * 시트를 찾는다. 정확 매칭 → 정규화 매칭 → 접두 번호 매칭('1)') 순으로 완화한다.
   * 사용자가 시트명을 살짝 바꿨다고 전체 업로드를 실패시키지 않기 위함.
   */
  sheet(declaredName) {
    const norm = normalizeSheetName(declaredName);
    let ws = this.index.get(norm);
    if (!ws) {
      const prefix = norm.match(/^\d+\)/);
      if (prefix) {
        for (const [key, cand] of this.index) {
          if (key.startsWith(prefix[0])) {
            ws = cand;
            break;
          }
        }
      }
    }
    return new Sheet(ws, ws ? ws.name : declaredName);
  }
}

module.exports = { Workbook, Sheet, colToNumber, numberToCol, normalizeSheetName, cellValue };
