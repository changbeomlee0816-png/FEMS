/* global window */
'use strict';

/**
 * 알람/이벤트 판정.
 *
 * 참고한 실제 관제화면들(ETAP · ABB Monitor Pro · Amkor K5 · 상수도 SCADA)은
 * 예외 없이 **화면 하단에 알람 바**를 두고, 미확인/활성 건수를 함께 띄운다.
 * 도면만 그리고 끝나는 화면은 현장에서 쓰이지 않는다.
 *
 * 알람은 저장하지 않고 **도면 + 최신 계측값에서 매번 다시 계산**한다.
 * 상태를 따로 들고 있지 않으므로 새로고침해도 화면과 항상 일치한다.
 * (운영에서 이력이 필요하면 FEMS 본 시스템의 alarms 테이블이 그 역할을 한다)
 */
window.ScadaAlarms = (function () {
  const STALE_MS = 10 * 60 * 1000;

  /** 심각도 — 색은 반드시 라벨·아이콘과 함께 쓴다 */
  const LEVELS = {
    urgent: { label: '긴급', rank: 3, icon: '✕' },
    caution: { label: '주의', rank: 2, icon: '!' },
    warning: { label: '경고', rank: 1, icon: '!' },
    info: { label: '정보', rank: 0, icon: 'i' },
  };

  function readingOf(live, key) {
    if (!key || !live || !live.values) return null;
    const r = live.values[key];
    if (!r || r.value == null) return null;
    const ts = r.ts ? new Date(r.ts.replace(' ', 'T') + (r.ts.endsWith('Z') ? '' : 'Z')).getTime() : 0;
    return { value: r.value, ts, stale: !ts || Date.now() - ts > STALE_MS };
  }

  /**
   * @param {object} diagram
   * @param {object} live      { values: { key: {value, ts} } }
   * @param {Set<string>} acked  확인 처리된 알람 키
   * @returns {{items:Array, active:number, unacked:number, worst:string|null}}
   */
  function evaluate(diagram, live, acked) {
    const items = [];
    if (!diagram) return { items, active: 0, unacked: 0, worst: null };

    const ackSet = acked || new Set();
    const zoneName = (n) => n.zoneName || n.zoneCode || '-';
    const tagOf = (n) => n.tag || (n.device ? `#${n.device.deviceId}/CH${n.channel}` : n.id);

    // 차단기 개폐로 정해지는 가압 상태 — 정전 구간에는 부하/미수신 알람을 내지 않는다.
    // (전원이 없어서 값이 없는 것을 "미수신" 이라고 부르면 관제가 시끄러워진다)
    const energized = window.ScadaCanvas && window.ScadaCanvas.energized ? window.ScadaCanvas.energized : null;
    const isLive = (n) => !energized || energized.has(n.id);

    for (const node of diagram.nodes) {
      const power = node.display && node.display.power;
      const r = power ? readingOf(live, power.key) : null;
      const rated = Number(node.ratedPower) || 0;

      // ⓪ 정전(비가압) — 차단기 개방으로 전원이 끊긴 구간
      if (!isLive(node)) {
        const self = node.breakerState === 'open';
        items.push(mk(self ? 'caution' : 'info', 'DE_ENERGIZED', node, zoneName(node), tagOf(node),
          self ? '차단기 개방 — 정전' : '상위 차단기 개방으로 정전', 0, ackSet));
        continue;
      }

      // ① 정격/계약전력 초과 — 관제에서 가장 먼저 봐야 하는 항목
      if (r && !r.stale && rated > 0) {
        const pct = (r.value / rated) * 100;
        if (pct > 100) {
          items.push(mk('urgent', 'OVERLOAD', node, zoneName(node), tagOf(node),
            `${node.kind === 'main' ? '계약전력' : '정격출력'} 초과 ${pct.toFixed(1)}% (${fmt(r.value)} / ${fmt(rated)} kW)`, r.ts, ackSet));
        } else if (pct > 90) {
          items.push(mk('caution', 'NEAR_LIMIT', node, zoneName(node), tagOf(node),
            `${node.kind === 'main' ? '계약전력' : '정격출력'} 임박 ${pct.toFixed(1)}%`, r.ts, ackSet));
        }
      }

      // ② 미수신 — 포인트가 붙어 있는데 값이 안 들어오는 경우
      if (power && (!r || r.stale)) {
        items.push(mk('caution', 'NO_DATA', node, zoneName(node), tagOf(node),
          r ? '계측값 미갱신 (최근 수신 없음)' : '계측값 미수신', r ? r.ts : 0, ackSet));
      }

      // ③ 사용여부 N 으로 등록된 장비
      if (node.device && node.device.active === false) {
        items.push(mk('info', 'DISABLED', node, zoneName(node), tagOf(node), '장비 사용여부 N — 비활성', 0, ackSet));
      }

      // ④ 계측 미연결 — 도면에는 있는데 포인트가 없는 설비
      if (!power && node.kind !== 'main' && (!node.points || node.points.length === 0)) {
        items.push(mk('info', 'NO_POINT', node, zoneName(node), tagOf(node), '계측 포인트 미연결', 0, ackSet));
      }
    }

    items.sort((a, b) => LEVELS[b.level].rank - LEVELS[a.level].rank || String(a.tag).localeCompare(String(b.tag)));

    return {
      items,
      active: items.filter((i) => i.level !== 'info').length,
      unacked: items.filter((i) => i.level !== 'info' && !i.acked).length,
      worst: items.length ? items[0].level : null,
    };
  }

  function mk(level, code, node, zone, tag, message, ts, ackSet) {
    const key = `${node.id}:${code}`;
    return {
      key, level, code, nodeId: node.id, name: node.name,
      zone, tag, message,
      ts: ts || null,
      acked: ackSet.has(key),
    };
  }

  function fmt(v) {
    return window.ScadaCharts ? window.ScadaCharts.fmt(v) : String(v);
  }

  return { evaluate, LEVELS };
})();
