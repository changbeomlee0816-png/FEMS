'use strict';

const db = require('./db');
const config = require('./config');
const alarms = require('./alarms');
const { CATEGORY } = config;

/**
 * 모니터링 엔진 - 제안서 12p "원격 모니터링 전략" 3대 축 구현
 *   1) 수신율 (Reception Rate)
 *   2) 데이터 정합성 (Data Integrity)
 *   3) 전력 피크 / 유효전력 Zero (Peak / Equipment Off)
 *
 * evaluate() 를 주기적으로 호출하면 포인트별 상태를 판정하고 알람을 정리한다.
 * getPointStatuses() / getSiteMetrics() 는 대시보드 API 가 그대로 사용한다.
 */

// ── 심각도 매처 ────────────────────────────────────────────
// 규칙은 config 에서 "가장 심각한 것부터" 정렬되어 있으므로 첫 매치가 결과.
function severityBelow(value, rules) {
  for (const r of rules) if (value < r.below) return r.severity;
  return null;
}
function severityOver(value, rules, key) {
  for (const r of rules) if (value > r[key]) return r.severity;
  return null;
}

const minutesSince = (ts) => (Date.now() - new Date(ts + 'Z').getTime()) / 60000;

// ISO 문자열이 'Z' 를 포함하는지에 따라 파싱 보정 (SQLite datetime은 UTC, 무접미)
function toMs(ts) {
  if (!ts) return null;
  const s = /[zZ+]/.test(ts) ? ts : ts.replace(' ', 'T') + 'Z';
  return new Date(s).getTime();
}

/**
 * 포인트 1개의 현재 상태를 판정한다.
 * @returns {object} status + 감지된 이상(issues) 배열
 */
function evaluatePoint(point) {
  const issues = [];
  const now = Date.now();

  const latest = db
    .prepare('SELECT * FROM readings WHERE point_id = ? ORDER BY ts DESC, id DESC LIMIT 1')
    .get(point.id);

  const lastMs = latest ? toMs(latest.ts) : null;
  const outageMin = lastMs ? (now - lastMs) / 60000 : Infinity;
  const staleLimit = point.expected_interval_sec * config.reception.staleFactor;
  const online = lastMs ? (now - lastMs) / 1000 <= staleLimit : false;

  // ── 1) 수신율: 개별 포인트 장기 미수신 추적 ──────────────
  if (!online) {
    const sev = severityOver(outageMin, config.reception.pointOutageSeverity, 'overMinutes');
    if (sev) {
      const mins = Number.isFinite(outageMin) ? Math.round(outageMin) : null;
      issues.push({
        point_id: point.id,
        site: point.site,
        category: CATEGORY.RECEPTION,
        severity: sev,
        code: 'POINT_OUTAGE',
        cause: '계측기 통신 끊김 / 판넬 전원 차단 의심',
        message:
          `[${point.name}] 데이터 미수신 ` +
          (mins != null ? `${mins}분 경과` : '이력 없음') +
          ` (기대주기 ${point.expected_interval_sec}s)`,
        dedup_key: `reception:point:${point.id}`,
      });
    }
  }

  // 최근 이력이 없으면 정합성/피크 판정은 생략
  if (!latest) {
    return {
      point,
      online,
      latest: null,
      outageMin,
      issues,
    };
  }

  // ── 2) 데이터 정합성 ──────────────────────────────────────
  // (a) 동일 값 지속 → 데이터 집계 오류 또는 통신 끊김 의심
  const recent = db
    .prepare('SELECT value FROM readings WHERE point_id = ? ORDER BY ts DESC, id DESC LIMIT 60')
    .all(point.id);
  let stuck = 1;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].value === recent[0].value) stuck++;
    else break;
  }
  if (stuck >= config.integrity.stuckCount) {
    const sev = severityOver(stuck, config.integrity.stuckSeverity, 'overCount');
    if (sev) {
      issues.push({
        point_id: point.id,
        site: point.site,
        category: CATEGORY.INTEGRITY,
        severity: sev,
        code: 'STUCK_VALUE',
        cause: '동일 값 지속 → 데이터 집계 오류/통신 끊김 의심',
        message: `[${point.name}] 동일 값(${recent[0].value}) ${stuck}회 연속 수신`,
        dedup_key: `integrity:stuck:${point.id}`,
      });
    }
  }

  // (b) 정상 범위 초과 이상치 (결선/센서 이상)
  if (point.min_normal != null || point.max_normal != null) {
    const v = latest.value;
    let overPct = 0;
    if (point.max_normal != null && v > point.max_normal) {
      overPct = ((v - point.max_normal) / Math.abs(point.max_normal || 1)) * 100;
    } else if (point.min_normal != null && v < point.min_normal) {
      overPct = ((point.min_normal - v) / Math.abs(point.min_normal || 1)) * 100;
    }
    if (overPct > 0) {
      const sev = severityOver(overPct, config.integrity.outOfRangeSeverity, 'overPct');
      if (sev) {
        issues.push({
          point_id: point.id,
          site: point.site,
          category: CATEGORY.INTEGRITY,
          severity: sev,
          code: 'OUT_OF_RANGE',
          cause: '정상 범위 초과 이상치 (센서/결선 이상 의심)',
          message:
            `[${point.name}] 이상치 ${v}${point.unit} ` +
            `(정상 ${point.min_normal ?? '-'}~${point.max_normal ?? '-'})`,
          dedup_key: `integrity:range:${point.id}`,
        });
      }
    }
  }

  // ── 3) 전력 피크 / 유효전력 Zero (전력계측기 한정) ────────
  let zeroMin = 0;
  if (point.type === 'power') {
    // (a) 유효전력 Zero 지속시간 산출
    const powerCol = 'effective_power';
    const series = db
      .prepare(
        `SELECT ts, ${powerCol} AS p, value FROM readings WHERE point_id = ? ORDER BY ts DESC, id DESC LIMIT 500`
      )
      .all(point.id);
    const val = (r) => (r.p != null ? r.p : r.value);
    if (series.length && val(series[0]) === 0) {
      // 최근이 0 → 마지막으로 0이 아니었던 시점까지의 지속시간
      let boundaryMs = toMs(series[series.length - 1].ts);
      for (const r of series) {
        if (val(r) !== 0) {
          boundaryMs = toMs(r.ts);
          break;
        }
      }
      zeroMin = (now - boundaryMs) / 60000;
      const sev = severityOver(zeroMin, config.peakZero.zeroPowerSeverity, 'overMinutes');
      if (sev) {
        issues.push({
          point_id: point.id,
          site: point.site,
          category: CATEGORY.ZERO,
          severity: sev,
          code: 'ZERO_POWER',
          cause: '유효전력 0 지속 → 설비 미가동 / 판넬 전원 차단 / 계측기 불량',
          message: `[${point.name}] 유효전력 Zero ${Math.round(zeroMin)}분 지속`,
          dedup_key: `zero:${point.id}`,
        });
      }
    }

    // (b) 전력 피크 임계 초과
    if (point.peak_threshold != null && latest.value > point.peak_threshold) {
      const overPct = ((latest.value - point.peak_threshold) / point.peak_threshold) * 100;
      const sev = severityOver(overPct, config.peakZero.peakSeverity, 'overPct');
      if (sev) {
        issues.push({
          point_id: point.id,
          site: point.site,
          category: CATEGORY.PEAK,
          severity: sev,
          code: 'POWER_PEAK',
          cause: '부하시간대별 전력 피크 초과',
          message: `[${point.name}] 전력 피크 ${latest.value}${point.unit} (임계 ${point.peak_threshold})`,
          dedup_key: `peak:${point.id}`,
        });
      }
    }
  }

  return { point, online, latest, outageMin, stuck, zeroMin, issues };
}

function activePoints() {
  return db.prepare('SELECT * FROM points WHERE active = 1').all();
}

/** 전체 포인트 상태 목록 (대시보드/포인트 API 공용) */
function getPointStatuses() {
  return activePoints().map((p) => {
    const s = evaluatePoint(p);
    const worst = s.issues.reduce(
      (m, i) => (m == null || config.SEVERITY_RANK[i.severity] > config.SEVERITY_RANK[m] ? i.severity : m),
      null
    );
    return {
      point_key: p.point_key,
      site: p.site,
      name: p.name,
      type: p.type,
      unit: p.unit,
      online: s.online,
      last_ts: s.latest ? s.latest.ts : null,
      last_value: s.latest ? s.latest.value : null,
      effective_power: s.latest ? s.latest.effective_power : null,
      outage_min: Number.isFinite(s.outageMin) ? Math.round(s.outageMin) : null,
      issue_count: s.issues.length,
      worst_severity: worst,
      categories: [...new Set(s.issues.map((i) => i.category))],
    };
  });
}

/** 사업장별 통합 지표 (수신율·정합성률·SLA 준수율) */
function getSiteMetrics(statuses) {
  const rows = statuses || getPointStatuses();
  const bySite = {};

  for (const site of config.sites) {
    if (!site.active) continue;
    bySite[site.id] = {
      site: site.id,
      name: site.name,
      total: 0,
      online: 0,
      integrityOk: 0,
      alarms: { 경고: 0, 주의: 0, 긴급: 0 },
    };
  }

  for (const st of rows) {
    const m = bySite[st.site];
    if (!m) continue;
    m.total++;
    if (st.online) m.online++;
    const hasIntegrity = st.categories.includes(CATEGORY.INTEGRITY);
    if (!hasIntegrity) m.integrityOk++;
  }

  // 활성 알람 심각도 카운트
  const active = db
    .prepare(`SELECT site, severity, COUNT(*) c FROM alarms WHERE status != 'resolved' GROUP BY site, severity`)
    .all();
  for (const a of active) {
    if (bySite[a.site] && bySite[a.site].alarms[a.severity] != null) {
      bySite[a.site].alarms[a.severity] = a.c;
    }
  }

  return Object.values(bySite).map((m) => {
    const reception = m.total ? (m.online / m.total) * 100 : 100;
    const integrity = m.total ? (m.integrityOk / m.total) * 100 : 100;
    const sla =
      reception * config.sla.receptionWeight + integrity * config.sla.integrityWeight;
    return {
      ...m,
      reception_rate: round1(reception),
      integrity_rate: round1(integrity),
      sla_compliance: round1(sla),
      reception_ok: reception >= config.reception.targetRate,
      sla_ok: sla >= config.sla.complianceTarget,
    };
  });
}

const round1 = (n) => Math.round(n * 10) / 10;

/** 주기적 평가: 포인트별 이상 감지 → 사업장 수신율 알람 → 알람 정리 */
function evaluate() {
  const statuses = getPointStatuses();
  const detected = [];

  // 포인트 단위 이상 수집
  for (const p of activePoints()) {
    const s = evaluatePoint(p);
    detected.push(...s.issues);
  }

  // 사업장 단위 수신율 저하 알람
  const metrics = getSiteMetrics(statuses);
  for (const m of metrics) {
    if (m.total === 0) continue;
    const sev = severityBelow(m.reception_rate, config.reception.siteSeverity);
    if (sev) {
      detected.push({
        point_id: null,
        site: m.site,
        category: CATEGORY.RECEPTION,
        severity: sev,
        code: 'SITE_RECEPTION_LOW',
        cause: '사업장 수신율 관리 목표(95%) 미달',
        message: `[${m.name}] 수신율 ${m.reception_rate}% (정상 ${m.online}/${m.total})`,
        dedup_key: `reception:site:${m.site}`,
      });
    }
  }

  alarms.reconcile(detected);
  return { evaluatedAt: new Date().toISOString(), points: statuses.length, detected: detected.length };
}

module.exports = { evaluate, getPointStatuses, getSiteMetrics, evaluatePoint };
