'use strict';

const S = require('./schema');
const codes = require('./codes');

/**
 * 엑셀 → 원시 모델 파싱.
 *
 * 여기서는 **형변환만** 하고 판단은 하지 않는다. 값이 이상해도 그대로 담아
 * `raw` 와 셀 주소를 보존한다. 옳고 그름은 전부 validator.js 가 판정한다.
 * (파서가 조용히 값을 고쳐버리면 "어느 셀이 잘못됐는지" 알려줄 수 없다.)
 */

/** 셀 하나를 {값, 원본, 주소} 로 감싼다. */
function field(sheet, col, row, label, cast) {
  const c = sheet.at(col, row);
  return {
    label,
    sheet: sheet.name,
    cell: c.cell,
    col,
    row,
    raw: c.value,
    value: cast ? cast(c.value) : c.value,
  };
}

const asText = (v) => (v == null ? null : String(v).trim() || null);
const asNumber = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN; // NaN = 숫자여야 하는데 아닌 값 → validator 가 잡는다
};
const asDate = (v) => {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? NaN : d;
};

function castFor(type) {
  if (type === 'int' || type === 'number' || type === 'year') return asNumber;
  if (type === 'date') return asDate;
  return asText;
}

/** 스키마 columns 정의대로 한 행을 읽는다. */
function readRow(sheet, spec, rowNum, carry) {
  const out = { __row: rowNum, __sheet: sheet.name };
  for (const c of spec.columns) {
    const f = field(sheet, c.col, rowNum, c.label, castFor(c.type));
    // 병합 셀(장비타입/제품명)은 값이 첫 행에만 있으므로 아래로 이어받는다.
    if (c.fill && f.value == null && carry && carry[c.key] != null) {
      out[c.key] = { ...carry[c.key], inherited: true, cell: f.cell, row: rowNum };
    } else {
      out[c.key] = f;
      if (c.fill && f.value != null && carry) carry[c.key] = f;
    }
  }
  return out;
}

// ── 0)기본정보 ─────────────────────────────────────────────────────
function parseBasic(wb) {
  const sh = wb.sheet(S.SHEETS.BASIC);
  const basic = { __sheet: sh.name, __exists: sh.exists };

  for (const f of S.BASIC_FIELDS) {
    const col = f.cell.replace(/\d+/g, '');
    const row = Number(f.cell.replace(/\D+/g, ''));
    basic[f.key] = field(sh, col, row, f.label, castFor(f.type));
  }

  // 기타 > 에너지원 사용 여부 (라벨 16행 / 값 17행)
  basic.energyUse = S.ENERGY_USE.cols.map((col) => ({
    label: field(sh, col, S.ENERGY_USE.labelRow, '에너지원').value,
    ...field(sh, col, S.ENERGY_USE.valueRow, '에너지원 값'),
  }));

  // 기타 > 건물규모 (동/존/층/연면적)
  basic.buildingScale = S.BUILDING_SCALE.cols.map((col) => ({
    label: field(sh, col, S.BUILDING_SCALE.labelRow, '건물규모').value,
    ...field(sh, col, S.BUILDING_SCALE.valueRow, '건물규모 값', asNumber),
  }));

  // 에너지 정보 : 열 = 에너지원 슬롯 1~4
  basic.energyInfo = S.ENERGY_INFO.cols.map((col, i) => {
    const slot = { slot: i + 1, col };
    for (const r of S.ENERGY_INFO.rows) {
      slot[r.key] = field(sh, col, r.row, r.label, castFor(r.type));
    }
    slot.__filled = S.ENERGY_INFO.rows.some((r) => slot[r.key].value != null);
    return slot;
  });

  return basic;
}

// ── 1)장비 ─────────────────────────────────────────────────────────
function parseDevices(wb) {
  const sh = wb.sheet(S.SHEETS.DEVICE);
  const rows = [];
  for (const r of sh.dataRows(S.DEVICE_SHEET.startRow, S.DEVICE_SHEET.identityCols)) {
    rows.push(readRow(sh, S.DEVICE_SHEET, r));
  }
  return { __sheet: sh.name, __exists: sh.exists, rows };
}

// ── 2)채널활성화 및 설비트리 ───────────────────────────────────────
function parseChannels(wb) {
  const sh = wb.sheet(S.SHEETS.CHANNEL);
  const rows = [];
  for (const r of sh.dataRows(S.CHANNEL_SHEET.startRow, S.CHANNEL_SHEET.identityCols)) {
    rows.push(readRow(sh, S.CHANNEL_SHEET, r));
  }
  return { __sheet: sh.name, __exists: sh.exists, rows };
}

// ── 3)에너지트리 ───────────────────────────────────────────────────
function parseEnergyTree(wb) {
  const sh = wb.sheet(S.SHEETS.ENERGY_TREE);
  const rows = [];
  for (const r of sh.dataRows(S.ENERGY_TREE_SHEET.startRow, S.ENERGY_TREE_SHEET.identityCols)) {
    rows.push(readRow(sh, S.ENERGY_TREE_SHEET, r));
  }
  return { __sheet: sh.name, __exists: sh.exists, rows };
}

// ── 4)장비속성 ─────────────────────────────────────────────────────
function parseDeviceProfiles(wb) {
  const sh = wb.sheet(S.SHEETS.DEVICE_PROFILE);
  const rows = [];
  const carry = {};
  const spec = S.DEVICE_PROFILE_SHEET;
  if (sh.exists) {
    const end = sh.ws.rowCount || spec.startRow;
    for (let r = spec.startRow; r <= end; r++) {
      // 병합 셀 이어받기는 빈 행에서도 유지돼야 하므로 dataRows() 대신 직접 순회한다.
      const identity = spec.identityCols.some((c) => sh.at(c, r).value != null);
      const label = spec.fillCols.some((c) => sh.at(c, r).value != null);
      if (!identity && !label) continue;
      const row = readRow(sh, spec, r, carry);
      if (identity) rows.push(row);
    }
  }

  // 제품명 단위로 묶어 "장비 프로파일"(연동 포인트 목록)을 만든다.
  const profiles = new Map();
  for (const row of rows) {
    const product = row.productName.value;
    if (!product) continue;
    const key = codes.normalizeKey(product);
    if (!profiles.has(key)) {
      profiles.set(key, {
        key,
        productName: product,
        deviceType: row.deviceType.value,
        points: [],
        firstRow: row.__row,
      });
    }
    const p = profiles.get(key);
    const roles = [];
    for (const r of codes.POINT_ROLES) {
      const mark = sh.at(r.col, row.__row).value;
      if (mark != null && String(mark).trim() !== '') {
        roles.push({ role: r.role, label: r.label, tree: r.tree, cell: `${r.col}${row.__row}` });
      }
    }
    p.points.push({
      row: row.__row,
      address: row.address.value,
      sourcePoint: row.sourcePoint.value,
      unit: row.unit.value,
      pointName: row.pointName.value,
      measureType: row.measureType.value,
      statType: row.statType.value,
      scale: row.scale.value,
      funcCode: row.funcCode.value,
      pointType: row.pointType.value,
      pointSize: row.pointSize.value,
      roles,
      cells: row,
    });
  }

  return { __sheet: sh.name, __exists: sh.exists, rows, profiles };
}

// ── 5)코드규칙 / 6)요금제목록 ─────────────────────────────────────
function parseCodeTables(wb) {
  const codeSheet = wb.sheet(S.SHEETS.CODE_RULE);
  const tariffSheet = wb.sheet(S.SHEETS.TARIFF);

  const eqSpec = S.CODE_RULE_SHEET.equipment;
  const equipment = codeSheet
    .columnList(eqSpec.col, eqSpec.startRow, eqSpec.endRow)
    .map((x) => x.value)
    .filter((v) => v && v !== '구분');

  const esSpec = S.CODE_RULE_SHEET.energySource;
  const energySources = [];
  if (codeSheet.exists) {
    for (let r = esSpec.startRow; r <= esSpec.endRow; r++) {
      const code = codeSheet.at(esSpec.codeCol, r).value;
      const name = codeSheet.at(esSpec.nameCol, r).value;
      if (code != null && name != null && Number.isFinite(Number(code))) {
        energySources.push({ code: Number(code), name: String(name).trim() });
      }
    }
  }

  const tSpec = S.TARIFF_SHEET;
  const tariffs = tariffSheet
    .columnList(tSpec.col, tSpec.startRow, tSpec.endRow)
    .map((x) => x.value)
    .filter(Boolean);

  // 시트가 비었거나 없으면 코드에 내장된 기본 코드표로 대체한다.
  return {
    equipment: equipment.length ? equipment : codes.EQUIPMENT_CODES,
    equipmentFromFile: equipment.length > 0,
    energySources: energySources.length ? energySources : codes.ENERGY_SOURCE_CODES,
    energySourcesFromFile: energySources.length > 0,
    tariffs: tariffs.length ? tariffs : codes.TARIFFS,
    tariffsFromFile: tariffs.length > 0,
  };
}


// ── 7)수전계통 · 8)변압기 · 9)구역 (v2, 선택) ─────────────────────
/** 스키마만 다른 동일 구조의 표 시트를 공통으로 읽는다. */
function parseTable(wb, sheetName, spec) {
  const sh = wb.sheet(sheetName);
  const rows = [];
  for (const r of sh.dataRows(spec.startRow, spec.identityCols)) {
    rows.push(readRow(sh, spec, r));
  }
  return { __sheet: sh.name, __exists: sh.exists, rows };
}

/** 워크북 전체 파싱 */
function parseWorkbook(wb) {
  return {
    sheetNames: wb.sheetNames,
    basic: parseBasic(wb),
    devices: parseDevices(wb),
    channels: parseChannels(wb),
    energyTree: parseEnergyTree(wb),
    deviceProfiles: parseDeviceProfiles(wb),
    codeTables: parseCodeTables(wb),
    incomers: parseTable(wb, S.SHEETS.INCOMER, S.INCOMER_SHEET),
    transformers: parseTable(wb, S.SHEETS.TRANSFORMER, S.TRANSFORMER_SHEET),
    zones: parseTable(wb, S.SHEETS.ZONE, S.ZONE_SHEET),
  };
}

module.exports = { parseWorkbook, parseTable, field, asNumber, asText, asDate };
