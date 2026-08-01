'use strict';

const codes = require('./codes');
const { buildDiagram } = require('./diagram');

/**
 * 엑셀 없이 시작하는 빈 도면.
 *
 * 엑셀 업로드 경로(parser → validator → model → diagram)와 **같은 모델 모양**을
 * 만들어 같은 도면 생성기에 넣는다. 그래서 빈 도면으로 시작해 화면에서 그린
 * 결과와, 엑셀로 올린 결과가 완전히 같은 문서 구조를 갖는다.
 *
 * 계측 연결(장비·채널·포인트)은 비어 있고, 나중에 엑셀을 올리거나
 * FEMS 포인트를 붙여 채운다.
 */
function blankModel(input = {}) {
  const factoryCode = String(input.factoryCode || 'SITE').trim() || 'SITE';

  const site = {
    factoryCode,
    company: input.company || '새 사업장',
    industry: input.industry || null,
    address: input.address || null,
    phone: null,
    masterAccountId: null,
    tariff: input.tariff || null,
    manager: { name: null, rank: null, mobile: null, email: null },
    contractPower: input.contractPower != null ? Number(input.contractPower) : null,
    receivingCapacity: input.receivingCapacity != null ? Number(input.receivingCapacity) : null,
    builtYear: null,
    headcount: null,
    annualEnergyToe: null,
    dailyOperatingHours: null,
    buildingScale: [],
    energyInfo: [],
  };

  // 한전 수전점 한 개로 시작한다. 빈 화면보다 "여기서부터 그리세요" 가 낫다.
  const energyTree = [
    {
      energySource: 1,
      energySourceName: '전력',
      name: input.mainName || '한전 수전',
      systemId: 1,
      level: 1,
      parentId: 0,
      deviceId: null,
      channel: null,
      voltage: input.voltage != null ? Number(input.voltage) : 22.9,
      deviceKind: 'INCOMER',
      ratedCurrent: null,
      breakingCapacity: null,
      ratedPower: input.contractPower != null ? Number(input.contractPower) : null,
      protection: [],
      zoneCode: null,
      tag: 'RCP-1',
    },
  ];

  return {
    site,
    devices: [],
    channels: [],
    facilityGroups: [],
    energyTree,
    incomers: [],
    transformers: [],
    zones: [],
    profiles: {},
    codeTables: {
      equipment: codes.EQUIPMENT_CODES.slice(),
      energySources: codes.ENERGY_SOURCE_CODES.slice(),
      tariffs: codes.TARIFFS.slice(),
    },
    __lookup: {
      deviceById: new Map(),
      channelByKey: new Map(),
      pointsFor: () => [],
      incomerBySystem: new Map(),
      transformerBySystem: new Map(),
      zoneByCode: new Map(),
    },
  };
}

/** 빈 도면 프로젝트 — 저장소에 그대로 넣을 수 있는 { model, diagram } */
function blankProject(input = {}) {
  const model = blankModel(input);
  const diagram = buildDiagram(model, {
    name: input.name || `${model.site.company} SCADA 도면`,
  });
  diagram.meta.source = 'manual';
  return { model, diagram };
}

module.exports = { blankModel, blankProject };
