'use strict';

const db = require('./db');
const config = require('./config');

/** 포인트 등록/수정 (point_key 기준 upsert) */
const upsertPoint = db.prepare(`
  INSERT INTO points (point_key, site, name, type, unit, expected_interval_sec,
                      min_normal, max_normal, peak_threshold, active)
  VALUES (@point_key, @site, @name, @type, @unit, @expected_interval_sec,
          @min_normal, @max_normal, @peak_threshold, @active)
  ON CONFLICT(point_key) DO UPDATE SET
    site = excluded.site,
    name = excluded.name,
    type = excluded.type,
    unit = excluded.unit,
    expected_interval_sec = excluded.expected_interval_sec,
    min_normal = excluded.min_normal,
    max_normal = excluded.max_normal,
    peak_threshold = excluded.peak_threshold,
    active = excluded.active
`);

function registerPoint(input) {
  const row = {
    point_key: String(input.point_key),
    site: String(input.site || 'K5'),
    name: String(input.name || input.point_key),
    type: input.type === 'flow' ? 'flow' : 'power',
    unit: input.unit != null ? String(input.unit) : '',
    expected_interval_sec: Number(input.expected_interval_sec) || 60,
    min_normal: input.min_normal != null ? Number(input.min_normal) : null,
    max_normal: input.max_normal != null ? Number(input.max_normal) : null,
    peak_threshold: input.peak_threshold != null ? Number(input.peak_threshold) : null,
    active: input.active === false ? 0 : 1,
  };
  upsertPoint.run(row);
  return db.prepare('SELECT * FROM points WHERE point_key = ?').get(row.point_key);
}

const getPointByKey = db.prepare('SELECT * FROM points WHERE point_key = ?');
const insertReading = db.prepare(
  `INSERT INTO readings (point_id, ts, value, effective_power, quality) VALUES (?, ?, ?, ?, ?)`
);

/**
 * 계측값 1건 저장. 미등록 포인트는 설정에 따라 자동 등록.
 * @returns {{ok:boolean, point_key:string, error?:string}}
 */
function ingestReading(r) {
  const key = r.point_key;
  if (!key) return { ok: false, error: 'point_key 누락' };
  if (r.value == null && r.effective_power == null)
    return { ok: false, point_key: key, error: 'value 누락' };

  let point = getPointByKey.get(key);
  if (!point) {
    if (!config.server.autoRegisterPoints)
      return { ok: false, point_key: key, error: '미등록 포인트' };
    point = registerPoint({ point_key: key, site: r.site, name: r.name, type: r.type, unit: r.unit });
  }

  const ts = normalizeTs(r.ts);
  insertReading.run(
    point.id,
    ts,
    r.value != null ? Number(r.value) : null,
    r.effective_power != null ? Number(r.effective_power) : null,
    r.quality || 'ok'
  );
  return { ok: true, point_key: key };
}

// 저장 형식을 SQLite datetime 과 동일한 'YYYY-MM-DD HH:MM:SS' (UTC) 로 통일
function normalizeTs(ts) {
  const d = ts ? new Date(ts) : new Date();
  const t = isNaN(d.getTime()) ? new Date() : d;
  return t.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { registerPoint, ingestReading, getPointByKey };
