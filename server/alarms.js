'use strict';

const db = require('./db');
const config = require('./config');
const notify = require('./notify');

/**
 * 알람 처리 계층.
 *
 * 모니터링 엔진(monitor.js)이 매 평가 주기마다 "현재 활성이어야 할 이상 목록"을
 * 만들어 raise() 로 전달한다. 여기서는 dedup_key 기준으로 신규/갱신을 판단하고,
 * 더 이상 감지되지 않는 알람은 자동 해제(resolve)한다.
 */

const upsertStmt = db.prepare(`
  INSERT INTO alarms (point_id, site, category, severity, code, message, cause, dedup_key)
  VALUES (@point_id, @site, @category, @severity, @code, @message, @cause, @dedup_key)
  ON CONFLICT(dedup_key) WHERE status != 'resolved'
  DO UPDATE SET
    severity = excluded.severity,
    message  = excluded.message,
    cause    = excluded.cause,
    last_ts  = datetime('now')
`);

const findActiveStmt = db.prepare(
  `SELECT * FROM alarms WHERE dedup_key = ? AND status != 'resolved'`
);

/**
 * 한 번의 평가 결과를 반영한다.
 * @param {Array<object>} detected  현재 감지된 이상 목록
 *   각 원소: { point_id, site, category, severity, code, message, cause, dedup_key }
 */
function reconcile(detected) {
  const seen = new Set();

  const tx = db.transaction((items) => {
    for (const d of items) {
      seen.add(d.dedup_key);
      const before = findActiveStmt.get(d.dedup_key);
      upsertStmt.run({
        point_id: d.point_id ?? null,
        site: d.site,
        category: d.category,
        severity: d.severity,
        code: d.code,
        message: d.message,
        cause: d.cause ?? null,
        dedup_key: d.dedup_key,
      });
      const after = findActiveStmt.get(d.dedup_key);
      // 신규 발생 또는 심각도 상승 시 알람 자동 발송 대상
      if (!before || config.SEVERITY_RANK[after.severity] > config.SEVERITY_RANK[before.severity]) {
        notify.dispatch(after);
        db.prepare('UPDATE alarms SET dispatched = 1 WHERE id = ?').run(after.id);
      }
    }

    // 이번 평가에서 더 이상 감지되지 않은 활성 알람은 자동 해제
    const active = db.prepare(`SELECT * FROM alarms WHERE status != 'resolved'`).all();
    for (const a of active) {
      if (!seen.has(a.dedup_key)) {
        db.prepare(
          `UPDATE alarms SET status = 'resolved', resolved_ts = datetime('now') WHERE id = ?`
        ).run(a.id);
      }
    }
  });

  tx(detected);
}

function ack(id) {
  return db.prepare(`UPDATE alarms SET status = 'ack' WHERE id = ? AND status = 'active'`).run(id);
}

function resolve(id) {
  return db
    .prepare(`UPDATE alarms SET status = 'resolved', resolved_ts = datetime('now') WHERE id = ?`)
    .run(id);
}

module.exports = { reconcile, ack, resolve };
