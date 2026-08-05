'use strict';

const S = require('./schema');
const codes = require('./codes');

/**
 * 업로드 엑셀 정밀 검증기.
 *
 * 원칙: **모든 지적은 셀 주소를 동반한다.** "형식이 잘못됐습니다" 같은
 * 뭉뚱그린 메시지를 내지 않고, 항상 `시트 / 셀 / 열 이름 / 현재 값 / 고치는 법`
 * 다섯 가지를 함께 돌려준다. 프런트엔드는 이 구조를 그대로 표로 그린다.
 *
 * level
 *  - error   : 도면을 만들 수 없음. 반드시 수정해야 함.
 *  - warning : 도면은 만들어지지만 확인이 필요함 (오입력 의심).
 *  - info    : 참고 사항.
 */

const RE = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  phone: /^0\d{1,2}-?\d{3,4}-?\d{4}$/,
  mobile: /^01[016789]-?\d{3,4}-?\d{4}$/,
  ipv4: /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/,
  slug: /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
};

class Report {
  constructor() {
    this.issues = [];
  }

  add(level, f, code, message, hint) {
    this.issues.push({
      level,
      code,
      sheet: f && f.sheet ? f.sheet : f && f.__sheet,
      cell: f && f.cell ? f.cell : null,
      row: f && f.row != null ? f.row : null,
      col: f && f.col ? f.col : null,
      column: f && f.label ? f.label : null,
      value: f && f.raw !== undefined ? stringify(f.raw) : null,
      message,
      hint: hint || null,
    });
  }

  error(f, code, message, hint) {
    this.add('error', f, code, message, hint);
  }
  warn(f, code, message, hint) {
    this.add('warning', f, code, message, hint);
  }
  info(f, code, message, hint) {
    this.add('info', f, code, message, hint);
  }

  get errorCount() {
    return this.issues.filter((i) => i.level === 'error').length;
  }
  get warningCount() {
    return this.issues.filter((i) => i.level === 'warning').length;
  }
}

function stringify(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  return String(v);
}

/** 공통 스칼라 규칙 검사 (필수·숫자·범위·형식) */
function checkField(rep, f, spec, ctx) {
  const label = spec.label;
  const v = f.value;

  if (spec.required && (v == null || v === '')) {
    rep.error(f, 'REQUIRED', `${label} 은(는) 필수 입력값입니다. 비어 있습니다.`, `${f.cell} 셀에 ${label} 을(를) 입력하세요.`);
    return false;
  }
  if (v == null || v === '') return true;

  if (spec.type === 'int' || spec.type === 'number' || spec.type === 'year') {
    if (Number.isNaN(v)) {
      rep.error(f, 'NOT_NUMBER', `${label} 은(는) 숫자여야 하는데 '${stringify(f.raw)}' 이(가) 입력되었습니다.`, '숫자만 입력하세요. (단위·문자·공백 제거)');
      return false;
    }
    if (spec.type === 'int' && !Number.isInteger(v)) {
      rep.error(f, 'NOT_INTEGER', `${label} 은(는) 정수여야 합니다. 현재 값: ${v}`, '소수점 없는 정수로 입력하세요.');
      return false;
    }
    if (spec.min != null && v < spec.min) {
      rep.error(f, 'OUT_OF_RANGE', `${label} 은(는) ${spec.min} 이상이어야 합니다. 현재 값: ${v}`);
      return false;
    }
    if (spec.max != null && v > spec.max) {
      rep.error(f, 'OUT_OF_RANGE', `${label} 은(는) ${spec.max} 이하여야 합니다. 현재 값: ${v}`);
      return false;
    }
  }

  if (spec.type === 'date' && Number.isNaN(v)) {
    rep.error(f, 'NOT_DATE', `${label} 을(를) 날짜로 인식할 수 없습니다. 현재 값: '${stringify(f.raw)}'`, '예) 2022-09-06 또는 2022-09-06 10:32:01');
    return false;
  }

  if (spec.type === 'yn' && !['Y', 'N'].includes(String(v).toUpperCase())) {
    rep.error(f, 'NOT_YN', `${label} 은(는) Y 또는 N 이어야 합니다. 현재 값: '${v}'`);
    return false;
  }

  if (spec.type === 'ipv4' && !RE.ipv4.test(String(v))) {
    rep.error(f, 'BAD_IP', `${label} 형식이 올바르지 않습니다. 현재 값: '${v}'`, 'IPv4 형식으로 입력하세요. 예) 100.100.0.11');
    return false;
  }
  if (spec.type === 'email' && !RE.email.test(String(v))) {
    rep.error(f, 'BAD_EMAIL', `${label} 형식이 올바르지 않습니다. 현재 값: '${v}'`, '예) name@company.co.kr');
    return false;
  }
  if (spec.type === 'phone' && !RE.phone.test(String(v).replace(/\s/g, ''))) {
    rep.warn(f, 'BAD_PHONE', `${label} 형식이 일반적이지 않습니다. 현재 값: '${v}'`, '예) 031-000-0000');
  }
  if (spec.type === 'mobile' && !RE.mobile.test(String(v).replace(/\s/g, ''))) {
    rep.error(f, 'BAD_MOBILE', `${label} 형식이 올바르지 않습니다. 현재 값: '${v}'`, '예) 010-0000-0000');
    return false;
  }
  if (spec.type === 'slug' && !RE.slug.test(String(v))) {
    rep.error(
      f,
      'BAD_SLUG',
      `${label} 에는 영문/숫자/-/_ 만 사용할 수 있습니다. 현재 값: '${v}'`,
      '접속 주소에 그대로 쓰이는 값입니다. 예) dongjin'
    );
    return false;
  }
  if (spec.type === 'tariff') {
    const list = ctx.codeTables.tariffs;
    if (!list.some((t) => codes.normalizeKey(t) === codes.normalizeKey(v))) {
      const near = codes.closestMatch(v, list);
      rep.error(
        f,
        'UNKNOWN_TARIFF',
        `요금제 '${v}' 은(는) 요금제 목록에 없습니다.`,
        near ? `'${near}' 을(를) 입력하려던 것인가요? (6)요금제목록 시트 참고)` : '6)요금제목록 시트의 값 중 하나를 그대로 입력하세요.'
      );
      return false;
    }
  }
  if (spec.type === 'enum:measure' && !codes.MEASURE_TYPES.includes(String(v))) {
    rep.error(f, 'BAD_ENUM', `계측유형은 ${codes.MEASURE_TYPES.join(' / ')} 중 하나여야 합니다. 현재 값: '${v}'`);
    return false;
  }
  if (spec.type === 'enum:stat' && !codes.STAT_TYPES.includes(String(v))) {
    rep.error(f, 'BAD_ENUM', `통계유형은 ${codes.STAT_TYPES.join(' / ')} 중 하나여야 합니다. 현재 값: '${v}'`);
    return false;
  }
  if (spec.type === 'enum:deviceKind') {
    const list = codes.DEVICE_KINDS.map((d) => d.code);
    if (!list.some((c) => c === String(v).toUpperCase())) {
      const near = codes.closestMatch(v, list);
      rep.error(
        f,
        'BAD_DEVICE_KIND',
        `기기종류 '${v}' 은(는) 정의되지 않은 코드입니다.`,
        near
          ? `'${near}' 을(를) 입력하려던 것인가요?`
          : `사용 가능: ${list.join(', ')}`
      );
      return false;
    }
  }
  if (spec.type === 'enum:feedMode' && !codes.FEED_MODES.includes(String(v))) {
    rep.error(f, 'BAD_ENUM', `운전구분은 ${codes.FEED_MODES.join(' / ')} 중 하나여야 합니다. 현재 값: '${v}'`);
    return false;
  }

  return true;
}

// ── 시트 존재 검사 ─────────────────────────────────────────────────
function validateSheets(rep, parsed) {
  const present = new Set(parsed.sheetNames.map((n) => n.replace(/\s/g, '').toLowerCase()));
  for (const name of S.REQUIRED_SHEETS) {
    const norm = name.replace(/\s/g, '').toLowerCase();
    const prefix = norm.match(/^\d+\)/);
    const found =
      present.has(norm) || (prefix && [...present].some((p) => p.startsWith(prefix[0])));
    if (!found) {
      rep.error(
        { sheet: name, label: '시트' },
        'MISSING_SHEET',
        `필수 시트 '${name}' 이(가) 없습니다.`,
        `업로드한 파일의 시트: ${parsed.sheetNames.join(', ')}`
      );
    }
  }
}

// ── 0)기본정보 ─────────────────────────────────────────────────────
function validateBasic(rep, parsed) {
  const b = parsed.basic;
  if (!b.__exists) return;

  for (const spec of S.BASIC_FIELDS) {
    checkField(rep, b[spec.key], spec, parsed);
  }

  const contract = b.contractPower;
  const capacity = b.receivingCapacity;
  if (
    Number.isFinite(contract.value) &&
    Number.isFinite(capacity.value) &&
    contract.value > capacity.value
  ) {
    rep.warn(
      contract,
      'CONTRACT_GT_CAPACITY',
      `요금 적용 전력(${contract.value}kW)이 수전용량(${capacity.value}kW)보다 큽니다.`,
      `${contract.cell} 와 ${capacity.cell} 값이 바뀌지 않았는지 확인하세요.`
    );
  }

  // 예시 문구가 그대로 남아 있는 경우 (양식을 덮어쓰지 않고 제출한 실수)
  const placeholders = [
    { f: b.factoryCode, hit: /cloud fems factory code/i },
    { f: b.kepcoAccount, hit: /한전고객번호|사이버지점/ },
    { f: b.kepcoPassword, hit: /비밀번호/ },
    { f: b.managerName, hit: /홍길동/ },
    { f: b.managerMobile, hit: /^010-?0000-?0000$/ },
    { f: b.managerEmail, hit: /^0000@/ },
    { f: b.phone, hit: /-?000-?0000$/ },
  ];
  for (const p of placeholders) {
    const v = p.f && p.f.value;
    if (v && p.hit.test(String(v))) {
      rep.error(
        p.f,
        'PLACEHOLDER',
        `${p.f.label} 에 양식의 예시 문구가 그대로 남아 있습니다. 현재 값: '${v}'`,
        `${p.f.cell} 셀을 실제 값으로 바꿔주세요.`
      );
    }
  }

  // 에너지 정보 (열 = 에너지원 슬롯)
  let filledSlots = 0;
  for (const slot of b.energyInfo) {
    if (!slot.__filled) continue;
    filledSlots++;
    for (const r of S.ENERGY_INFO.rows) {
      checkField(rep, slot[r.key], r, parsed);
    }
    for (const key of ['toeFactor', 'co2Factor']) {
      const f = slot[key];
      if (Number.isFinite(f.value) && f.value <= 0) {
        rep.warn(f, 'NON_POSITIVE_FACTOR', `${f.label} 이(가) ${f.value} 입니다. 0보다 큰 값이어야 합니다.`);
      }
    }
  }
  if (filledSlots === 0) {
    rep.error(
      { sheet: b.__sheet, cell: 'C27', row: 27, col: 'C', label: '에너지 정보' },
      'NO_ENERGY_INFO',
      '에너지 정보(27~32행)가 비어 있습니다. 최소 1개 에너지원을 입력해야 합니다.',
      'C27 부터 종류/기본단위/탭표시명/환산계수를 입력하세요.'
    );
  }

}

// ── 1)장비 ─────────────────────────────────────────────────────────
function validateDevices(rep, parsed, ctx) {
  const rows = parsed.devices.rows;
  if (!parsed.devices.__exists) return;

  if (rows.length === 0) {
    rep.error(
      { sheet: parsed.devices.__sheet, cell: 'A3', row: 3, col: 'A', label: '장비ID' },
      'NO_DEVICE',
      '등록된 장비가 한 대도 없습니다. 3행부터 장비 정보를 입력하세요.'
    );
    return;
  }

  const seenId = new Map();
  const seenIp = new Map();
  const productKeys = new Set([...parsed.deviceProfiles.profiles.keys()]);
  const productNames = [...parsed.deviceProfiles.profiles.values()].map((p) => p.productName);

  for (const row of rows) {
    for (const spec of S.DEVICE_SHEET.columns) checkField(rep, row[spec.key], spec, parsed);

    const id = row.deviceId;
    if (Number.isInteger(id.value)) {
      if (seenId.has(id.value)) {
        rep.error(
          id,
          'DUPLICATE_ID',
          `장비ID ${id.value} 이(가) 중복되었습니다. (${seenId.get(id.value)} 셀에서 이미 사용)`,
          '장비ID는 1번부터 중복 없이 부여해야 합니다.'
        );
      } else {
        seenId.set(id.value, id.cell);
        ctx.devices.set(id.value, row);
      }
    }

    const ip = row.ip;
    if (ip.value && RE.ipv4.test(String(ip.value))) {
      if (seenIp.has(ip.value)) {
        rep.warn(
          ip,
          'DUPLICATE_IP',
          `IP 주소 ${ip.value} 이(가) ${seenIp.get(ip.value)} 셀과 중복됩니다.`,
          '같은 장비를 두 번 등록한 것이 아닌지 확인하세요. (멀티 채널 장비는 1대만 등록)'
        );
      } else {
        seenIp.set(ip.value, ip.cell);
      }
    }

    // 제품명은 4)장비속성에 연동 포인트 정의가 있어야 계측포인트를 만들 수 있다.
    const pn = row.productName;
    if (pn.value && !productKeys.has(codes.normalizeKey(pn.value))) {
      const near = codes.closestMatch(pn.value, productNames);
      rep.error(
        pn,
        'UNKNOWN_PRODUCT',
        `제품명 '${pn.value}' 에 대한 연동 포인트 정의가 '${S.SHEETS.DEVICE_PROFILE}' 시트에 없습니다.`,
        near
          ? `'${near}' 을(를) 입력하려던 것인가요?`
          : `'${S.SHEETS.DEVICE_PROFILE}' 시트에 해당 제품의 포인트 목록을 추가하거나, 신규 장비이면 별도 요청이 필요합니다.`
      );
    }

    if (row.useYn.value && String(row.useYn.value).toUpperCase() === 'N') {
      rep.info(row.useYn, 'DEVICE_DISABLED', `장비ID ${id.value} 은(는) 사용여부가 N 입니다. 도면에서 비활성으로 표시됩니다.`);
    }
  }
}

// ── 2)채널활성화 및 설비트리 ───────────────────────────────────────
function validateChannels(rep, parsed, ctx) {
  const rows = parsed.channels.rows;
  if (!parsed.channels.__exists) return;

  if (rows.length === 0) {
    rep.error(
      { sheet: parsed.channels.__sheet, cell: 'A3', row: 3, col: 'A', label: '장비ID' },
      'NO_CHANNEL',
      '활성화된 채널이 없습니다. 3행부터 채널 정보를 입력하세요.'
    );
    return;
  }

  const seenChannel = new Map(); // "장비-채널" → cell
  const groupIdByName = new Map(); // 설비그룹명 → {id, cell}
  const groupNameById = new Map();
  const facilityIdInGroup = new Map(); // "그룹ID-설비ID" → cell
  const equipmentList = parsed.codeTables.equipment;

  for (const row of rows) {
    for (const spec of S.CHANNEL_SHEET.columns) checkField(rep, row[spec.key], spec, parsed);

    const dev = row.deviceId;
    const ch = row.channel;

    // 장비 참조 무결성
    if (Number.isInteger(dev.value) && !ctx.devices.has(dev.value)) {
      rep.error(
        dev,
        'UNKNOWN_DEVICE',
        `장비ID ${dev.value} 은(는) '${S.SHEETS.DEVICE}' 시트에 등록되어 있지 않습니다.`,
        `'${S.SHEETS.DEVICE}' 시트에 먼저 장비를 등록하거나, 장비ID를 올바르게 수정하세요.`
      );
    }

    if (Number.isInteger(dev.value) && Number.isInteger(ch.value)) {
      const key = `${dev.value}-${ch.value}`;
      if (seenChannel.has(key)) {
        rep.error(
          ch,
          'DUPLICATE_CHANNEL',
          `장비ID ${dev.value} 의 채널 ${ch.value} 이(가) 중복되었습니다. (${seenChannel.get(key)} 셀에서 이미 사용)`,
          '채널정보는 장비ID별로 1번부터 순번을 중복 없이 부여합니다.'
        );
      } else {
        seenChannel.set(key, ch.cell);
        ctx.channels.set(key, row);
      }

      const device = ctx.devices.get(dev.value);
      const max = device && device.powerChannels.value;
      if (Number.isInteger(max) && ch.value > max) {
        rep.warn(
          ch,
          'CHANNEL_OVER_CAPACITY',
          `채널 ${ch.value} 이(가) 장비의 전력 채널 수(${max})를 초과합니다.`,
          `'${S.SHEETS.DEVICE}' 시트 ${device.powerChannels.cell} 의 전력 채널 수를 확인하세요.`
        );
      }
    }

    // 설비트리 연동 블록 (D~H) : 통합 채널은 전부 비워두는 것이 정상
    const treeCols = ['equipmentCode', 'groupName', 'groupId', 'facilityName', 'facilityId'];
    const filled = treeCols.filter((k) => row[k].value != null);
    if (filled.length > 0 && filled.length < treeCols.length) {
      const missing = treeCols.filter((k) => row[k].value == null);
      for (const k of missing) {
        rep.error(
          row[k],
          'PARTIAL_FACILITY_TREE',
          `설비트리 연동 정보가 일부만 입력되었습니다. ${row[k].label} 이(가) 비어 있습니다.`,
          '설비코드정보·설비그룹명·설비그룹ID·설비명·설비ID 는 함께 입력하거나 모두 비워두어야 합니다. (통합 채널은 모두 비움)'
        );
      }
    }

    const eq = row.equipmentCode;
    if (eq.value && !equipmentList.some((c) => codes.normalizeKey(c) === codes.normalizeKey(eq.value))) {
      const near = codes.closestMatch(eq.value, equipmentList);
      rep.error(
        eq,
        'UNKNOWN_EQUIPMENT_CODE',
        `설비코드 '${eq.value}' 은(는) 설비코드 규칙에 없는 값입니다.`,
        near ? `'${near}' 을(를) 입력하려던 것인가요? (5)코드규칙 시트 참고)` : '5)코드규칙 시트의 설비코드 중 하나를 입력하세요. (없으면 신규 요청)'
      );
    }

    // 설비그룹명 ↔ 설비그룹ID 1:1 정합성
    const gname = row.groupName;
    const gid = row.groupId;
    if (gname.value && Number.isInteger(gid.value)) {
      const prevId = groupIdByName.get(gname.value);
      if (prevId && prevId.id !== gid.value) {
        rep.error(
          gid,
          'GROUP_ID_CONFLICT',
          `설비그룹 '${gname.value}' 에 서로 다른 설비그룹ID 가 부여되었습니다. (${prevId.cell}=${prevId.id}, 여기=${gid.value})`,
          '설비그룹당 ID 는 1개만 사용해야 합니다.'
        );
      } else if (!prevId) {
        groupIdByName.set(gname.value, { id: gid.value, cell: gid.cell });
      }

      const prevName = groupNameById.get(gid.value);
      if (prevName && prevName.name !== gname.value) {
        rep.error(
          gname,
          'GROUP_NAME_CONFLICT',
          `설비그룹ID ${gid.value} 이(가) 두 개의 그룹명에 쓰였습니다. ('${prevName.name}' @${prevName.cell} / '${gname.value}')`,
          '설비그룹ID 는 그룹마다 고유해야 합니다.'
        );
      } else if (!prevName) {
        groupNameById.set(gid.value, { name: gname.value, cell: gname.cell });
      }

      if (Number.isInteger(row.facilityId.value)) {
        const fkey = `${gid.value}-${row.facilityId.value}`;
        if (facilityIdInGroup.has(fkey)) {
          rep.error(
            row.facilityId,
            'DUPLICATE_FACILITY_ID',
            `설비그룹 '${gname.value}' 안에서 설비ID ${row.facilityId.value} 이(가) 중복되었습니다. (${facilityIdInGroup.get(fkey)} 셀)`,
            '설비ID 는 그룹 내에서 1번부터 순차 부여합니다.'
          );
        } else {
          facilityIdInGroup.set(fkey, row.facilityId.cell);
        }
      }
    }

    // 한전 수전점으로 보이는 채널의 설비코드 오입력 감지
    const load = row.loadName.value || '';
    if (/한전|수전|메인|main|incom/i.test(load) && eq.value && !/수배전반/.test(eq.value)) {
      rep.warn(
        eq,
        'MAIN_EQUIPMENT_CODE',
        `측정부하명이 '${load}' 인데 설비코드가 '${eq.value}' 입니다.`,
        `한전 수전(메인)이라면 설비코드는 '수배전반' 이 맞습니다. ${eq.cell} 셀을 확인하세요.`
      );
    }
  }
}

// ── 3)에너지트리 ───────────────────────────────────────────────────
function validateEnergyTree(rep, parsed, ctx) {
  const rows = parsed.energyTree.rows;
  if (!parsed.energyTree.__exists) return;

  if (rows.length === 0) {
    rep.error(
      { sheet: parsed.energyTree.__sheet, cell: 'A3', row: 3, col: 'A', label: '에너지원' },
      'NO_ENERGY_TREE',
      '에너지 계통이 하나도 없습니다. 최소한 한전 메인(레벨 1) 한 개는 있어야 도면을 만들 수 있습니다.'
    );
    return;
  }

  const energyCodes = parsed.codeTables.energySources.map((e) => e.code);
  const byId = new Map();
  const mappingSeen = new Map();

  for (const row of rows) {
    for (const spec of S.ENERGY_TREE_SHEET.columns) checkField(rep, row[spec.key], spec, parsed);

    const es = row.energySource;
    if (Number.isInteger(es.value) && !energyCodes.includes(es.value)) {
      rep.error(
        es,
        'UNKNOWN_ENERGY_SOURCE',
        `에너지원 코드 ${es.value} 은(는) 정의되지 않은 값입니다.`,
        `사용 가능한 코드: ${parsed.codeTables.energySources.map((e) => `${e.code}=${e.name}`).join(', ')}`
      );
    }

    const sid = row.systemId;
    if (Number.isInteger(sid.value)) {
      if (byId.has(sid.value)) {
        rep.error(
          sid,
          'DUPLICATE_SYSTEM_ID',
          `에너지계통 ID ${sid.value} 이(가) 중복되었습니다. (${byId.get(sid.value).systemId.cell} 셀에서 이미 사용)`,
          '에너지계통 ID 는 행마다 중복 없이 부여해야 합니다.'
        );
      } else {
        byId.set(sid.value, row);
      }
    }
  }

  // 부모 참조 / 레벨 정합성
  for (const row of rows) {
    const level = row.level.value;
    const parent = row.parentId;
    if (!Number.isInteger(level) || !Number.isInteger(parent.value)) continue;

    if (level === 1) {
      if (parent.value !== 0) {
        rep.error(
          parent,
          'ROOT_PARENT',
          `계통레벨이 1(최상위)인데 연결계통ID 가 ${parent.value} 입니다.`,
          '최상위 계통(한전 메인)의 연결계통ID 는 0 이어야 합니다.'
        );
      }
      continue;
    }

    if (parent.value === 0) {
      rep.error(
        parent,
        'ORPHAN_LEVEL',
        `계통레벨이 ${level} 인데 연결계통ID 가 0 입니다.`,
        '레벨 2 이상은 상위 계통의 "에너지계통 ID" 를 연결계통ID 에 입력해야 합니다.'
      );
      continue;
    }

    const parentRow = byId.get(parent.value);
    if (!parentRow) {
      rep.error(
        parent,
        'UNKNOWN_PARENT',
        `연결계통ID ${parent.value} 에 해당하는 에너지계통이 없습니다.`,
        '상위 계통의 "에너지계통 ID" 값을 확인하세요.'
      );
      continue;
    }
    if (Number.isInteger(parentRow.level.value) && parentRow.level.value !== level - 1) {
      rep.error(
        row.level,
        'LEVEL_MISMATCH',
        `계통레벨 ${level} 인데 상위 계통(ID ${parent.value}, '${parentRow.systemName.value}')의 레벨은 ${parentRow.level.value} 입니다.`,
        `상위 레벨 + 1 이어야 합니다. ${row.level.cell} 또는 ${parentRow.level.cell} 을(를) 수정하세요.`
      );
    }
  }

  // 순환 참조
  for (const row of rows) {
    const seen = new Set();
    let cur = row;
    while (cur && Number.isInteger(cur.parentId.value) && cur.parentId.value !== 0) {
      if (seen.has(cur.systemId.value)) {
        rep.error(
          row.parentId,
          'CYCLE',
          `에너지계통 연결이 순환합니다. (계통 ${row.systemId.value} → … → 자기 자신)`,
          '연결계통ID 를 다시 확인하세요.'
        );
        break;
      }
      seen.add(cur.systemId.value);
      cur = byId.get(cur.parentId.value);
    }
  }

  // 계측 매핑 (장비ID + 채널) 존재 확인
  for (const row of rows) {
    const dev = row.deviceId;
    const ch = row.channel;
    if (dev.value == null && ch.value == null) {
      if (Number.isInteger(row.level.value) && row.level.value >= 2) {
        rep.warn(
          dev,
          'NO_MEASUREMENT',
          `계통 '${row.systemName.value}' 에 연결된 계측 채널이 없습니다.`,
          '장비ID·채널정보를 입력하면 도면에 실시간 계측값이 표시됩니다.'
        );
      }
      continue;
    }
    if (dev.value == null || ch.value == null) {
      const missing = dev.value == null ? dev : ch;
      rep.error(
        missing,
        'PARTIAL_MAPPING',
        `${missing.label} 이(가) 비어 있습니다. 장비ID 와 채널정보는 함께 입력해야 합니다.`
      );
      continue;
    }
    const key = `${dev.value}-${ch.value}`;
    if (!ctx.channels.has(key)) {
      rep.error(
        ch,
        'UNKNOWN_CHANNEL_MAPPING',
        `장비ID ${dev.value} 의 채널 ${ch.value} 이(가) '${S.SHEETS.CHANNEL}' 시트에 없습니다.`,
        `해당 채널을 '${S.SHEETS.CHANNEL}' 시트에 먼저 등록하세요.`
      );
      continue;
    }
    if (mappingSeen.has(key)) {
      rep.warn(
        ch,
        'DUPLICATE_MAPPING',
        `장비 ${dev.value} 채널 ${ch.value} 이(가) 두 계통에 중복 연결되었습니다. (${mappingSeen.get(key)} 셀)`,
        '같은 계측 채널이 두 계통에 붙으면 에너지 합계가 이중 계상됩니다.'
      );
    } else {
      mappingSeen.set(key, ch.cell);
    }
  }

  // 최상위 계통 = 한전 메인. 업체당 보통 1~2 개.
  const roots = rows.filter((r) => r.level.value === 1 || r.parentId.value === 0);
  ctx.rootCount = roots.length;
  if (roots.length === 0) {
    rep.error(
      { sheet: parsed.energyTree.__sheet, cell: 'D3', row: 3, col: 'D', label: '계통레벨' },
      'NO_ROOT',
      '최상위 계통(한전 메인)이 없습니다.',
      '계통레벨 1, 연결계통ID 0 인 행을 최소 1개 입력하세요.'
    );
  } else if (roots.length > 2) {
    rep.warn(
      roots[2].systemId,
      'TOO_MANY_MAINS',
      `한전 메인(최상위 계통)이 ${roots.length} 개입니다. 한 업체는 보통 1~2 개입니다.`,
      '메인이 아닌 계통이 레벨 1 로 잘못 입력되지 않았는지 확인하세요. (도면에서는 그대로 생성됩니다)'
    );
  }

  // ID 번호 건너뜀 (오류는 아니지만 관리상 알림)
  const ids = [...byId.keys()].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i <= (ids[ids.length - 1] || 0); i++) if (!byId.has(i)) gaps.push(i);
  if (gaps.length) {
    rep.info(
      { sheet: parsed.energyTree.__sheet, cell: 'C3', row: 3, col: 'C', label: '에너지계통 ID' },
      'ID_GAP',
      `에너지계통 ID 가 건너뛰었습니다: ${gaps.join(', ')} 번 없음.`,
      '중복만 없으면 동작에는 문제가 없습니다.'
    );
  }
}

// ── 4)장비속성 ─────────────────────────────────────────────────────
function validateDeviceProfiles(rep, parsed) {
  const p = parsed.deviceProfiles;
  if (!p.__exists) return;

  if (p.rows.length === 0) {
    rep.error(
      { sheet: p.__sheet, cell: 'C4', row: 4, col: 'C', label: 'Address' },
      'NO_PROFILE',
      '장비별 연동 포인트가 하나도 정의되어 있지 않습니다.'
    );
    return;
  }

  for (const row of p.rows) {
    for (const spec of S.DEVICE_PROFILE_SHEET.columns) {
      if (spec.fill && row[spec.key] && row[spec.key].inherited) continue;
      checkField(rep, row[spec.key], spec, parsed);
    }
    if (!row.productName.value) {
      rep.error(
        row.productName,
        'REQUIRED',
        '제품명을 알 수 없습니다. (병합 셀로 이어받을 상위 값도 없음)',
        `${row.__row} 행이 속한 장비의 제품명을 B열에 입력하세요.`
      );
    }
  }

  // 전력량계 프로파일에 전력/사용량 매핑이 없으면 SCADA 도면에 표시할 값이 없다.
  for (const profile of p.profiles.values()) {
    if (!/전력량계|전력계|power|meter/i.test(String(profile.deviceType || ''))) continue;
    const roles = new Set(profile.points.flatMap((pt) => pt.roles.map((r) => r.role)));
    for (const [role, label] of [['power', '전력'], ['usage', '사용량']]) {
      if (!roles.has(role)) {
        rep.warn(
          { sheet: p.__sheet, cell: `A${profile.firstRow}`, row: profile.firstRow, col: 'A', label: '에너지트리 매핑정보' },
          'MISSING_ROLE_MAPPING',
          `제품 '${profile.productName}' 에 '${label}' 매핑(O 표시)이 없습니다.`,
          `${profile.firstRow} 행 부근의 '${label}' 열에 해당 포인트를 O 로 표시하세요. 도면의 실시간 값 표시에 사용됩니다.`
        );
      }
    }
  }
}


// ── v2 시트 (7)수전계통 · 8)변압기 · 9)구역) ───────────────────────
// 셋 다 선택 사항이다. 없으면 검사를 건너뛰고, 있으면 계통과의 연결까지 확인한다.

function validateV2Sheets(rep, parsed, ctx) {
  const systemIds = ctx.systemIds || new Set();
  const zoneCodes = new Set();

  // 9)구역 — 도면 화면 분할
  if (parsed.zones.__exists && parsed.zones.rows.length) {
    const seen = new Map();
    for (const row of parsed.zones.rows) {
      for (const spec of S.ZONE_SHEET.columns) checkField(rep, row[spec.key], spec, parsed);
      const code = row.zoneCode;
      if (code.value) {
        const key = String(code.value).trim();
        if (seen.has(key)) {
          rep.error(code, 'DUPLICATE_ZONE', `구역코드 '${key}' 이(가) 중복되었습니다. (${seen.get(key)} 셀)`);
        } else {
          seen.set(key, code.cell);
          zoneCodes.add(key);
        }
      }
    }
  }
  ctx.zoneCodes = zoneCodes;

  // 7)수전계통 — 회선별 상세. 계통의 최상위(레벨1)와 짝을 이뤄야 한다.
  if (parsed.incomers.__exists && parsed.incomers.rows.length) {
    const seenLine = new Map();
    const seenSystem = new Map();
    for (const row of parsed.incomers.rows) {
      for (const spec of S.INCOMER_SHEET.columns) checkField(rep, row[spec.key], spec, parsed);

      const id = row.lineId;
      if (Number.isInteger(id.value)) {
        if (seenLine.has(id.value)) {
          rep.error(id, 'DUPLICATE_ID', `회선ID ${id.value} 이(가) 중복되었습니다. (${seenLine.get(id.value)} 셀)`);
        } else seenLine.set(id.value, id.cell);
      }

      const sid = row.systemId;
      if (Number.isInteger(sid.value)) {
        if (!systemIds.has(sid.value)) {
          rep.error(
            sid,
            'UNKNOWN_SYSTEM',
            `연결계통ID ${sid.value} 에 해당하는 에너지계통이 '${S.SHEETS.ENERGY_TREE}' 시트에 없습니다.`,
            '수전 회선은 최상위 계통(레벨 1)에 연결해야 합니다.'
          );
        } else {
          const node = ctx.systemById.get(sid.value);
          if (node && Number.isInteger(node.level.value) && node.level.value !== 1) {
            rep.error(
              sid,
              'INCOMER_NOT_ROOT',
              `계통 ${sid.value} ('${node.systemName.value}') 은(는) 레벨 ${node.level.value} 입니다. 수전 회선은 레벨 1 계통에만 연결됩니다.`,
              `${S.SHEETS.ENERGY_TREE} 시트 ${node.level.cell} 을(를) 확인하세요.`
            );
          }
          if (seenSystem.has(sid.value)) {
            rep.error(sid, 'DUPLICATE_SYSTEM', `계통 ${sid.value} 에 수전 회선이 두 번 연결되었습니다. (${seenSystem.get(sid.value)} 셀)`);
          } else seenSystem.set(sid.value, sid.cell);
        }
      }

      const v = row.voltage;
      if (Number.isFinite(v.value) && v.value > 0 && !codes.VOLTAGE_LEVELS.includes(v.value)) {
        rep.warn(
          v,
          'UNUSUAL_VOLTAGE',
          `수전전압 ${v.value}kV 는 표준 전압이 아닙니다.`,
          `일반적인 값: ${codes.VOLTAGE_LEVELS.slice(0, 6).join(' / ')} kV. 단위가 V 로 입력되지 않았는지 확인하세요.`
        );
      }
    }
  }

  // 8)변압기 — 제원 + 온도 감시 포인트
  if (parsed.transformers.__exists && parsed.transformers.rows.length) {
    const seen = new Map();
    for (const row of parsed.transformers.rows) {
      for (const spec of S.TRANSFORMER_SHEET.columns) checkField(rep, row[spec.key], spec, parsed);

      const id = row.trId;
      if (Number.isInteger(id.value)) {
        if (seen.has(id.value)) {
          rep.error(id, 'DUPLICATE_ID', `변압기ID ${id.value} 이(가) 중복되었습니다. (${seen.get(id.value)} 셀)`);
        } else seen.set(id.value, id.cell);
      }

      const sid = row.systemId;
      if (Number.isInteger(sid.value) && !systemIds.has(sid.value)) {
        rep.error(
          sid,
          'UNKNOWN_SYSTEM',
          `연결계통ID ${sid.value} 에 해당하는 에너지계통이 없습니다.`,
          `'${S.SHEETS.ENERGY_TREE}' 시트의 에너지계통 ID 를 확인하세요.`
        );
      }

      const p1 = row.primaryVoltage;
      const p2 = row.secondaryVoltage;
      if (Number.isFinite(p1.value) && Number.isFinite(p2.value) && p1.value > 0 && p2.value > 0) {
        if (p1.value <= p2.value) {
          rep.warn(
            p1,
            'TR_VOLTAGE_ORDER',
            `1차전압(${p1.value}kV)이 2차전압(${p2.value}kV)보다 크지 않습니다.`,
            `강압 변압기라면 값이 바뀌지 않았는지 ${p1.cell} · ${p2.cell} 을(를) 확인하세요.`
          );
        }
      }

      const vg = row.vectorGroup;
      if (vg.value && !codes.VECTOR_GROUPS.some((g) => codes.normalizeKey(g) === codes.normalizeKey(vg.value))) {
        const near = codes.closestMatch(vg.value, codes.VECTOR_GROUPS);
        rep.warn(
          vg,
          'UNKNOWN_VECTOR_GROUP',
          `결선 '${vg.value}' 은(는) 일반적인 표기가 아닙니다.`,
          near ? `'${near}' 인가요?` : `예) ${codes.VECTOR_GROUPS.slice(0, 4).join(', ')}`
        );
      }

      const cool = row.cooling;
      if (cool.value && !codes.COOLING_TYPES.some((c) => codes.normalizeKey(c) === codes.normalizeKey(cool.value))) {
        rep.warn(cool, 'UNKNOWN_COOLING', `냉각방식 '${cool.value}' 은(는) 일반적인 표기가 아닙니다.`, `예) ${codes.COOLING_TYPES.slice(0, 5).join(', ')}`);
      }

      // 온도 감시 포인트는 장비ID·채널을 함께 입력해야 한다
      for (const [dk, ck, label] of [
        ['windingTempDevice', 'windingTempChannel', '권선온도'],
        ['oilTempDevice', 'oilTempChannel', '유온'],
      ]) {
        const d = row[dk];
        const c = row[ck];
        if ((d.value == null) !== (c.value == null)) {
          const missing = d.value == null ? d : c;
          rep.error(missing, 'PARTIAL_MAPPING', `${label} 감시의 ${missing.label} 이(가) 비어 있습니다. 장비ID 와 채널은 함께 입력해야 합니다.`);
        } else if (d.value != null && c.value != null && !ctx.channels.has(`${d.value}-${c.value}`)) {
          rep.error(
            c,
            'UNKNOWN_CHANNEL_MAPPING',
            `${label} 감시 채널(장비 ${d.value} / 채널 ${c.value})이 '${S.SHEETS.CHANNEL}' 시트에 없습니다.`
          );
        }
      }
    }
  }
}

/** 에너지트리의 v2 확장 열 검사 (전압·기기종류·정격·보호요소·구역) */
function validateEnergyTreeV2(rep, parsed, ctx) {
  if (!parsed.energyTree.__exists) return;
  const protectionCodes = new Set(codes.PROTECTION_CODES.map((p) => p.code.toUpperCase()));

  for (const row of parsed.energyTree.rows) {
    const v = row.voltage;
    if (Number.isFinite(v.value) && v.value > 0) {
      if (v.value > 800) {
        rep.error(
          v,
          'VOLTAGE_UNIT',
          `전압 ${v.value} 는 kV 단위로는 비현실적입니다. V 로 입력하신 것 같습니다.`,
          '예) 380V → 0.38, 22900V → 22.9'
        );
      } else if (!codes.VOLTAGE_LEVELS.includes(v.value)) {
        rep.info(v, 'UNUSUAL_VOLTAGE', `전압 ${v.value}kV 는 표준 전압 목록에 없습니다.`, `표준: ${codes.VOLTAGE_LEVELS.join(' / ')}`);
      }
    }

    const prot = row.protection;
    if (prot.value) {
      for (const raw of String(prot.value).split(/[,/·|]/)) {
        const code = raw.trim().toUpperCase();
        if (!code) continue;
        if (!protectionCodes.has(code)) {
          const near = codes.closestMatch(code, [...protectionCodes]);
          rep.warn(
            prot,
            'UNKNOWN_PROTECTION',
            `보호요소 '${raw.trim()}' 은(는) 정의된 코드가 아닙니다.`,
            near ? `'${near}' 인가요? (ANSI 기기번호)` : '예) 50/51, 51G, 87T, 27, 59, 64, 81'
          );
        }
      }
    }

    const zone = row.zoneCode;
    if (zone.value && ctx.zoneCodes && ctx.zoneCodes.size && !ctx.zoneCodes.has(String(zone.value).trim())) {
      const near = codes.closestMatch(zone.value, [...ctx.zoneCodes]);
      rep.error(
        zone,
        'UNKNOWN_ZONE',
        `구역코드 '${zone.value}' 이(가) '${S.SHEETS.ZONE}' 시트에 없습니다.`,
        near ? `'${near}' 인가요?` : `'${S.SHEETS.ZONE}' 시트에 구역을 먼저 등록하세요.`
      );
    }

    // 차단용량은 개폐기기에만 의미가 있다
    const kind = row.deviceKind.value ? String(row.deviceKind.value).toUpperCase() : null;
    const bc = row.breakingCapacity;
    if (Number.isFinite(bc.value) && bc.value > 0 && kind && !['GCB', 'VCB', 'ACB', 'MCCB', 'LBS'].includes(kind)) {
      rep.info(bc, 'BREAKING_ON_NON_BREAKER', `기기종류가 ${kind} 인데 차단용량이 입력되었습니다.`, '차단용량은 차단기(GCB/VCB/ACB/MCCB)에 입력하는 값입니다.');
    }
  }
}

/**
 * 전체 검증.
 * @returns {{issues:Array, errorCount:number, warningCount:number, summary:object}}
 */
function validate(parsed) {
  const rep = new Report();
  const ctx = { devices: new Map(), channels: new Map(), rootCount: 0 };

  validateSheets(rep, parsed);
  validateBasic(rep, parsed);
  validateDeviceProfiles(rep, parsed);
  validateDevices(rep, parsed, ctx);
  validateChannels(rep, parsed, ctx);
  validateEnergyTree(rep, parsed, ctx);

  // v2 확장 — 계통 인덱스를 먼저 만들어 두고 참조 검사에 쓴다
  ctx.systemById = new Map();
  ctx.systemIds = new Set();
  for (const row of parsed.energyTree.rows) {
    if (Number.isInteger(row.systemId.value) && !ctx.systemById.has(row.systemId.value)) {
      ctx.systemById.set(row.systemId.value, row);
      ctx.systemIds.add(row.systemId.value);
    }
  }
  validateV2Sheets(rep, parsed, ctx);
  validateEnergyTreeV2(rep, parsed, ctx);

  // 사용되지 않은 채널 알림 (설비트리에는 있는데 에너지트리에 안 붙은 채널)
  const mapped = new Set(
    parsed.energyTree.rows
      .filter((r) => r.deviceId.value != null && r.channel.value != null)
      .map((r) => `${r.deviceId.value}-${r.channel.value}`)
  );
  for (const [key, row] of ctx.channels) {
    if (!mapped.has(key)) {
      rep.info(
        row.loadName,
        'CHANNEL_NOT_IN_TREE',
        `채널 '${row.loadName.value}' (장비 ${row.deviceId.value} / 채널 ${row.channel.value}) 이(가) 에너지트리에 연결되지 않았습니다.`,
        '도면에는 표시되지 않습니다. 필요하면 3)에너지트리 에 계통을 추가하세요.'
      );
    }
  }

  const order = { error: 0, warning: 1, info: 2 };
  rep.issues.sort((a, b) => order[a.level] - order[b.level] || String(a.sheet).localeCompare(String(b.sheet)) || (a.row || 0) - (b.row || 0));

  return {
    issues: rep.issues,
    errorCount: rep.errorCount,
    warningCount: rep.warningCount,
    infoCount: rep.issues.filter((i) => i.level === 'info').length,
    ok: rep.errorCount === 0,
    summary: {
      devices: ctx.devices.size,
      channels: ctx.channels.size,
      energyNodes: parsed.energyTree.rows.length,
      mains: ctx.rootCount,
      products: parsed.deviceProfiles.profiles.size,
      incomerLines: parsed.incomers.rows.length,
      transformers: parsed.transformers.rows.length,
      zones: parsed.zones.rows.length,
    },
    ctx,
  };
}

module.exports = { validate, Report, RE };
