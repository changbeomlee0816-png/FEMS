'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const store = require('../store');
const monitor = require('../monitor');
const alarms = require('../alarms');

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// 데이터 수집 (Ingestion) — 외부 소스 프로그램이 연결되는 지점
// ─────────────────────────────────────────────────────────────

/**
 * POST /api/ingest
 * 단건:   { point_key, ts, value, effective_power }
 * 배치:   { readings: [ {...}, {...} ] }
 * 외부 "소스를 주는 프로그램" 은 이 엔드포인트로 계측값을 밀어넣는다.
 */
router.post('/ingest', (req, res) => {
  const body = req.body || {};
  const list = Array.isArray(body.readings)
    ? body.readings
    : Array.isArray(body)
    ? body
    : [body];

  const results = { accepted: 0, rejected: 0, errors: [] };
  const tx = db.transaction((items) => {
    for (const r of items) {
      const out = store.ingestReading(r);
      if (out.ok) results.accepted++;
      else {
        results.rejected++;
        results.errors.push({ point_key: out.point_key, error: out.error });
      }
    }
  });
  tx(list);

  res.json({ ok: true, ...results });
});

/** POST /api/points — 계측 포인트 등록/수정 (단건 또는 배열) */
router.post('/points', (req, res) => {
  const body = req.body;
  const list = Array.isArray(body) ? body : [body];
  const saved = list.map((p) => store.registerPoint(p));
  res.json({ ok: true, count: saved.length, points: saved });
});

/** GET /api/points — 포인트 상태 목록 (선택: ?site=K5) */
router.get('/points', (req, res) => {
  let rows = monitor.getPointStatuses();
  if (req.query.site) rows = rows.filter((r) => r.site === req.query.site);
  res.json({ ok: true, count: rows.length, points: rows });
});

/** GET /api/points/:key — 포인트 상세 + 최근 계측 이력 */
router.get('/points/:key', (req, res) => {
  const point = store.getPointByKey.get(req.params.key);
  if (!point) return res.status(404).json({ ok: false, error: '포인트를 찾을 수 없음' });
  const limit = Math.min(Number(req.query.limit) || 200, 2000);
  const readings = db
    .prepare('SELECT ts, value, effective_power, quality FROM readings WHERE point_id = ? ORDER BY ts DESC, id DESC LIMIT ?')
    .all(point.id, limit);
  const status = monitor.evaluatePoint(point);
  res.json({
    ok: true,
    point,
    status: { online: status.online, outage_min: Math.round(status.outageMin) || 0, issues: status.issues },
    readings,
  });
});

// ─────────────────────────────────────────────────────────────
// 통합 대시보드 (제안서 13p)
// ─────────────────────────────────────────────────────────────

/** GET /api/dashboard — 사업장별 수신율·정합성·SLA + 전체 요약 */
router.get('/dashboard', (req, res) => {
  const statuses = monitor.getPointStatuses();
  const sites = monitor.getSiteMetrics(statuses);

  const totals = sites.reduce(
    (a, s) => {
      a.total += s.total;
      a.online += s.online;
      a.alarms.경고 += s.alarms.경고;
      a.alarms.주의 += s.alarms.주의;
      a.alarms.긴급 += s.alarms.긴급;
      return a;
    },
    { total: 0, online: 0, alarms: { 경고: 0, 주의: 0, 긴급: 0 } }
  );
  const overallReception = totals.total ? (totals.online / totals.total) * 100 : 100;

  res.json({
    ok: true,
    generated_at: new Date().toISOString(),
    target_reception: config.reception.targetRate,
    summary: {
      sites: sites.length,
      points: totals.total,
      online: totals.online,
      reception_rate: Math.round(overallReception * 10) / 10,
      active_alarms: totals.alarms,
    },
    sites,
  });
});

// ─────────────────────────────────────────────────────────────
// 알람
// ─────────────────────────────────────────────────────────────

/** GET /api/alarms — 활성/전체 알람 (필터: ?status= &severity= &site= &category=) */
router.get('/alarms', (req, res) => {
  const clauses = [];
  const params = [];
  const { status, severity, site, category } = req.query;
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  } else {
    clauses.push("status != 'resolved'"); // 기본: 활성 알람
  }
  if (severity) (clauses.push('severity = ?'), params.push(severity));
  if (site) (clauses.push('site = ?'), params.push(site));
  if (category) (clauses.push('category = ?'), params.push(category));

  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db
    .prepare(
      `SELECT a.*, p.point_key, p.name AS point_name
         FROM alarms a LEFT JOIN points p ON p.id = a.point_id
         ${where}
         ORDER BY CASE a.severity WHEN '긴급' THEN 3 WHEN '주의' THEN 2 ELSE 1 END DESC, a.last_ts DESC
         LIMIT 500`
    )
    .all(...params);
  res.json({ ok: true, count: rows.length, alarms: rows });
});

/** POST /api/alarms/:id/ack — 접수(확인) 처리 */
router.post('/alarms/:id/ack', (req, res) => {
  const r = alarms.ack(Number(req.params.id));
  res.json({ ok: r.changes > 0 });
});

/** POST /api/alarms/:id/resolve — 수동 해제 */
router.post('/alarms/:id/resolve', (req, res) => {
  const r = alarms.resolve(Number(req.params.id));
  res.json({ ok: r.changes > 0 });
});

// ─────────────────────────────────────────────────────────────
// 이력 데이터 분석 (제안서 13p: 월간 재발 패턴 / 예방정비 리포트)
// ─────────────────────────────────────────────────────────────

/** GET /api/reports/recurrence — 포인트·원인코드별 재발 빈도 (기본 30일) */
router.get('/reports/recurrence', (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const rows = db
    .prepare(
      `SELECT a.site, a.category, a.code, p.point_key, p.name AS point_name,
              COUNT(*) AS occurrences,
              SUM(CASE WHEN a.severity='긴급' THEN 1 ELSE 0 END) AS urgent,
              MAX(a.last_ts) AS last_seen
         FROM alarms a LEFT JOIN points p ON p.id = a.point_id
        WHERE a.first_ts >= datetime('now', ?)
        GROUP BY a.site, a.category, a.code, a.point_id
        ORDER BY occurrences DESC
        LIMIT 200`
    )
    .all(`-${days} days`);
  res.json({ ok: true, window_days: days, items: rows });
});

/** GET /api/reports/summary — 심각도/카테고리별 발생 집계 */
router.get('/reports/summary', (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const byCategory = db
    .prepare(
      `SELECT category, severity, COUNT(*) c FROM alarms
        WHERE first_ts >= datetime('now', ?) GROUP BY category, severity`
    )
    .all(`-${days} days`);
  res.json({ ok: true, window_days: days, by_category: byCategory });
});

module.exports = router;
