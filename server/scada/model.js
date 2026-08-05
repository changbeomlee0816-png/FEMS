'use strict';

const codes = require('./codes');

/**
 * 검증을 통과한 파싱 결과 → 도면/FEMS 연동에 쓰는 정규 모델.
 *
 * 이 모델은 엑셀에서 완전히 분리되어 있다. 나중에 FEMS 본 시스템이
 * 엑셀이 아닌 DB/API 에서 같은 모양의 모델을 만들어 넣으면
 * 도면 생성기(diagram.js)는 그대로 재사용된다.
 */

/** FEMS 계측 포인트 키 규칙 — 수집기(POST /api/ingest)와 도면이 공유하는 유일한 식별자. */
function pointKey(factoryCode, deviceId, channel, suffix) {
  return `${factoryCode}.D${deviceId}.C${channel}.${suffix}`;
}

function val(f) {
  return f && f.value !== undefined ? f.value : null;
}

function buildModel(parsed) {
  const b = parsed.basic;
  const factoryCode = val(b.factoryCode) || 'site';

  const site = {
    factoryCode,
    company: val(b.companyName),
    industry: val(b.industry),
    address: val(b.address),
    phone: val(b.phone),
    masterAccountId: val(b.masterAccountId),
    tariff: val(b.tariff),
    manager: {
      name: val(b.managerName),
      rank: val(b.managerRank),
      mobile: val(b.managerMobile),
      email: val(b.managerEmail),
    },
    contractPower: val(b.contractPower),
    receivingCapacity: val(b.receivingCapacity),
    energyInfo: b.energyInfo
      .filter((s) => s.__filled)
      .map((s) => ({
        slot: s.slot,
        kind: val(s.kind),
        baseUnit: val(s.baseUnit),
        toeFactor: val(s.toeFactor),
        co2Factor: val(s.co2Factor),
        unitPrice: val(s.unitPrice),
      })),
  };

  const devices = parsed.devices.rows.map((r) => ({
    deviceId: val(r.deviceId),
    deviceType: val(r.deviceType),
    productName: val(r.productName),
    productKey: codes.normalizeKey(val(r.productName)),
    location: val(r.location),
    ip: val(r.ip),
    port: val(r.port),

    sendCycle: val(r.sendCycle),
    monitorCycle: val(r.monitorCycle),
    powerChannels: val(r.powerChannels),
    active: String(val(r.useYn) || 'Y').toUpperCase() !== 'N',
    installedAt: val(r.installedAt) instanceof Date ? val(r.installedAt).toISOString() : null,
  }));
  const deviceById = new Map(devices.map((d) => [d.deviceId, d]));

  const channels = parsed.channels.rows.map((r) => ({
    deviceId: val(r.deviceId),
    channel: val(r.channel),
    loadName: val(r.loadName),
    equipmentCode: val(r.equipmentCode),
    groupName: val(r.groupName),
    groupId: val(r.groupId),
    facilityName: val(r.facilityName),
    facilityId: val(r.facilityId),
  }));
  const channelByKey = new Map(channels.map((c) => [`${c.deviceId}-${c.channel}`, c]));

  // 설비 트리 (2)채널활성화 의 설비그룹 기준)
  const groupMap = new Map();
  for (const c of channels) {
    if (!c.groupName || c.groupId == null) continue;
    if (!groupMap.has(c.groupId)) groupMap.set(c.groupId, { groupId: c.groupId, name: c.groupName, facilities: [] });
    groupMap.get(c.groupId).facilities.push({
      facilityId: c.facilityId,
      name: c.facilityName,
      equipmentCode: c.equipmentCode,
      deviceId: c.deviceId,
      channel: c.channel,
    });
  }
  const facilityGroups = [...groupMap.values()].sort((a, b) => a.groupId - b.groupId);

  // 제품별 연동 포인트 프로파일
  const profiles = {};
  for (const [key, p] of parsed.deviceProfiles.profiles) {
    profiles[key] = {
      productName: p.productName,
      deviceType: p.deviceType,
      points: p.points.map((pt, i) => ({
        index: i,
        address: pt.address,
        sourcePoint: pt.sourcePoint,
        unit: pt.unit,
        pointName: pt.pointName,
        measureType: pt.measureType,
        statType: pt.statType,
        scale: pt.scale,
        funcCode: pt.funcCode,
        pointType: pt.pointType,
        pointSize: pt.pointSize,
        roles: pt.roles.map((r) => r.role),
      })),
    };
  }

  const energySourceName = new Map(parsed.codeTables.energySources.map((e) => [e.code, e.name]));

  /** 보호요소 문자열 → 코드 배열 ("50/51, 51G" → ['50','51','51G']) */
  function parseProtection(v) {
    if (!v) return [];
    return String(v)
      .split(/[,/·|]/)
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
  }

  const energyTree = parsed.energyTree.rows.map((r) => ({
    systemId: val(r.systemId),
    name: val(r.systemName),
    level: val(r.level),
    parentId: val(r.parentId),
    energySource: val(r.energySource),
    energySourceName: energySourceName.get(val(r.energySource)) || null,
    deviceId: val(r.deviceId),
    channel: val(r.channel),
    // v2 확장 — 없으면 null 이고 도면은 기존과 동일하게 그려진다
    voltage: val(r.voltage),
    deviceKind: val(r.deviceKind) ? String(val(r.deviceKind)).toUpperCase() : null,
    ratedCurrent: val(r.ratedCurrent),
    breakingCapacity: val(r.breakingCapacity),
    ratedPower: val(r.ratedPower),
    protection: parseProtection(val(r.protection)),
    zoneCode: val(r.zoneCode) ? String(val(r.zoneCode)).trim() : null,
    tag: val(r.tag) ? String(val(r.tag)).trim() : null,
  }));

  // ── v2 시트 ──────────────────────────────────────────────────────
  const incomers = parsed.incomers.rows.map((r) => ({
    lineId: val(r.lineId),
    lineName: val(r.lineName),
    substation: val(r.substation),
    voltage: val(r.voltage),
    contractPower: val(r.contractPower),
    cableSpec: val(r.cableSpec),
    feedMode: val(r.feedMode),
    systemId: val(r.systemId),
  }));

  const transformers = parsed.transformers.rows.map((r) => ({
    trId: val(r.trId),
    name: val(r.name),
    systemId: val(r.systemId),
    primaryVoltage: val(r.primaryVoltage),
    secondaryVoltage: val(r.secondaryVoltage),
    capacity: val(r.capacity),
    vectorGroup: val(r.vectorGroup),
    impedance: val(r.impedance),
    cooling: val(r.cooling),
    windingTemp: val(r.windingTempDevice) != null && val(r.windingTempChannel) != null
      ? { deviceId: val(r.windingTempDevice), channel: val(r.windingTempChannel) }
      : null,
    oilTemp: val(r.oilTempDevice) != null && val(r.oilTempChannel) != null
      ? { deviceId: val(r.oilTempDevice), channel: val(r.oilTempChannel) }
      : null,
  }));

  const zones = parsed.zones.rows
    .map((r) => ({
      code: val(r.zoneCode) ? String(val(r.zoneCode)).trim() : null,
      name: val(r.zoneName),
      order: val(r.order),
      note: val(r.note),
    }))
    .filter((z) => z.code)
    .sort((a, b) => (a.order || 999) - (b.order || 999));

  /** 계통 노드에 붙는 계측 포인트 목록 생성 (FEMS 연동 지점) */
  function pointsFor(deviceId, channel) {
    if (deviceId == null || channel == null) return [];
    const dev = deviceById.get(deviceId);
    if (!dev) return [];
    const profile = profiles[dev.productKey];
    if (!profile) return [];
    return profile.points.map((pt) => {
      const role = pt.roles[0] || null;
      const suffix = role ? role.toUpperCase() : `P${pt.index}`;
      return {
        key: pointKey(factoryCode, deviceId, channel, suffix),
        name: pt.pointName,
        unit: pt.unit,
        role,
        roles: pt.roles,
        measureType: pt.measureType,
        statType: pt.statType,
        deviceId,
        channel,
        address: pt.address,
        scale: pt.scale,
      };
    });
  }

  return {
    site,
    devices,
    channels,
    facilityGroups,
    energyTree,
    incomers,
    transformers,
    zones,
    profiles,
    codeTables: {
      equipment: parsed.codeTables.equipment,
      energySources: parsed.codeTables.energySources,
      tariffs: parsed.codeTables.tariffs,
    },
    // 헬퍼는 직렬화 대상이 아니므로 별도 반환
    __lookup: {
      deviceById,
      channelByKey,
      pointsFor,
      incomerBySystem: new Map(incomers.filter((i) => i.systemId != null).map((i) => [i.systemId, i])),
      transformerBySystem: new Map(transformers.filter((t) => t.systemId != null).map((t) => [t.systemId, t])),
      zoneByCode: new Map(zones.map((z) => [z.code, z])),
    },
  };
}

module.exports = { buildModel, pointKey };
