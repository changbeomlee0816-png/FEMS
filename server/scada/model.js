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
    builtYear: val(b.builtYear),
    headcount: val(b.headcount),
    annualEnergyToe: val(b.annualEnergyToe),
    dailyOperatingHours: val(b.dailyOperatingHours),
    buildingScale: b.buildingScale.filter((x) => x.value != null).map((x) => ({ label: x.label, value: x.value })),
    energyInfo: b.energyInfo
      .filter((s) => s.__filled)
      .map((s) => ({
        slot: s.slot,
        kind: val(s.kind),
        baseUnit: val(s.baseUnit),
        tabName: val(s.tabName),
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
    measuredFacility: val(r.measuredFacility),
    location: val(r.location),
    ip: val(r.ip),
    port: val(r.port),
    protocolType: val(r.protocolType),
    engineId: val(r.engineId),
    offset: val(r.offset),
    sendCycle: val(r.sendCycle),
    monitorCycle: val(r.monitorCycle),
    powerChannels: val(r.powerChannels),
    calc: String(val(r.calcYn) || '').toUpperCase() === 'Y',
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

  const energyTree = parsed.energyTree.rows.map((r) => ({
    systemId: val(r.systemId),
    name: val(r.systemName),
    level: val(r.level),
    parentId: val(r.parentId),
    energySource: val(r.energySource),
    energySourceName: energySourceName.get(val(r.energySource)) || null,
    deviceId: val(r.deviceId),
    channel: val(r.channel),
  }));

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
    profiles,
    codeTables: {
      equipment: parsed.codeTables.equipment,
      energySources: parsed.codeTables.energySources,
      tariffs: parsed.codeTables.tariffs,
    },
    // 헬퍼는 직렬화 대상이 아니므로 별도 반환
    __lookup: { deviceById, channelByKey, pointsFor },
  };
}

module.exports = { buildModel, pointKey };
