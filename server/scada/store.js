'use strict';

const db = require('../db');
const femsStore = require('../store');
const { collectPoints } = require('./diagram');

/**
 * SCADA 도면 프로젝트 저장소.
 *
 * `publish()` 가 곧 **FEMS 본 시스템과의 연동 지점**이다.
 * 도면에 붙은 계측 포인트를 FEMS 의 points 테이블에 등록하면,
 * 기존 수집기(POST /api/ingest)·모니터링 엔진·알람이 그대로 이 도면을 대상으로 동작한다.
 */

const insert = db.prepare(`
  INSERT INTO scada_projects (name, factory_code, company, site, source_filename, model_json, diagram_json, report_json)
  VALUES (@name, @factory_code, @company, @site, @source_filename, @model_json, @diagram_json, @report_json)
`);

const updateDiagram = db.prepare(`
  UPDATE scada_projects
     SET diagram_json = @diagram_json, name = @name, updated_at = datetime('now')
   WHERE id = @id
`);

const selectOne = db.prepare('SELECT * FROM scada_projects WHERE id = ?');
const selectList = db.prepare(`
  SELECT id, name, factory_code, company, site, source_filename, published_at, created_at, updated_at
    FROM scada_projects ORDER BY updated_at DESC LIMIT ?
`);
const deleteOne = db.prepare('DELETE FROM scada_projects WHERE id = ?');
const markPublished = db.prepare(`UPDATE scada_projects SET published_at = datetime('now') WHERE id = ?`);

/** 모델에서 직렬화 불가능한 헬퍼(__lookup) 를 떼어낸다. */
function serializableModel(model) {
  const { __lookup, ...rest } = model;
  return rest;
}

function create({ name, model, diagram, report, sourceFilename, site }) {
  const info = insert.run({
    name,
    factory_code: model.site.factoryCode || null,
    company: model.site.company || null,
    site: site || model.site.factoryCode || null,
    source_filename: sourceFilename || null,
    model_json: JSON.stringify(serializableModel(model)),
    diagram_json: JSON.stringify(diagram),
    report_json: report ? JSON.stringify(report) : null,
  });
  return get(info.lastInsertRowid);
}

function get(id) {
  const row = selectOne.get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    factoryCode: row.factory_code,
    company: row.company,
    site: row.site,
    sourceFilename: row.source_filename,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    model: JSON.parse(row.model_json),
    diagram: JSON.parse(row.diagram_json),
    report: row.report_json ? JSON.parse(row.report_json) : null,
  };
}

function list(limit = 50) {
  return selectList.all(limit).map((r) => ({
    id: r.id,
    name: r.name,
    factoryCode: r.factory_code,
    company: r.company,
    site: r.site,
    sourceFilename: r.source_filename,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

function saveDiagram(id, diagram, name) {
  const cur = selectOne.get(id);
  if (!cur) return null;
  updateDiagram.run({
    id,
    diagram_json: JSON.stringify(diagram),
    name: name || cur.name,
  });
  return get(id);
}

function remove(id) {
  return deleteOne.run(id).changes > 0;
}

/**
 * 도면의 계측 포인트를 FEMS points 테이블에 등록한다.
 *
 * 등록 후에는 외부 수집 프로그램이 `POST /api/ingest` 로 같은 point_key 를 보내면
 * 도면 위 값이 살아 움직이고, 기존 수신율·정합성 알람 로직이 그대로 적용된다.
 */
function publish(id, { site } = {}) {
  const project = get(id);
  if (!project) return null;

  const targetSite = site || project.site || project.factoryCode || 'FEMS';
  const points = collectPoints(project.diagram);
  const nodeById = new Map(project.diagram.nodes.map((n) => [n.id, n]));

  const registered = [];
  const tx = db.transaction(() => {
    for (const p of points) {
      const node = nodeById.get(p.nodeId);
      const device = project.model.devices.find((d) => d.deviceId === p.deviceId);
      const intervalMin = device && device.sendCycle ? Number(device.sendCycle) : 15;
      registered.push(
        femsStore.registerPoint({
          point_key: p.key,
          site: targetSite,
          name: `${p.nodeName} · ${p.name}`,
          type: /유량|flow|m3/i.test(String(p.unit || '')) ? 'flow' : 'power',
          unit: p.unit || '',
          expected_interval_sec: Math.max(30, intervalMin * 60),
          peak_threshold: p.role === 'power' && node && node.ratedPower ? Number(node.ratedPower) : null,
          active: true,
        })
      );
    }
    markPublished.run(id);
  });
  tx();

  return { projectId: id, site: targetSite, count: registered.length, points: registered.map((r) => r.point_key) };
}

/**
 * 도면에 바인딩된 포인트들의 최근 계측값을 읽어온다 (실시간 화면용).
 * FEMS 연동 전에는 값이 없으므로 null 로 내려가고, 화면은 '--' 로 표시한다.
 */
const latestByKeys = db.prepare(`
  SELECT p.point_key, r.value, r.effective_power, r.ts
    FROM points p
    LEFT JOIN readings r ON r.id = (
      SELECT id FROM readings WHERE point_id = p.id ORDER BY ts DESC, id DESC LIMIT 1
    )
   WHERE p.point_key IN (SELECT value FROM json_each(?))
`);

function liveValues(id) {
  const project = get(id);
  if (!project) return null;
  const keys = collectPoints(project.diagram).map((p) => p.key);
  if (keys.length === 0) return { ts: new Date().toISOString(), values: {} };

  const rows = latestByKeys.all(JSON.stringify(keys));
  const values = {};
  for (const r of rows) {
    values[r.point_key] = {
      value: r.value != null ? r.value : r.effective_power,
      ts: r.ts,
    };
  }
  return { ts: new Date().toISOString(), values, bound: keys.length, live: rows.filter((r) => r.ts).length };
}

module.exports = { create, get, list, saveDiagram, remove, publish, liveValues, serializableModel };
