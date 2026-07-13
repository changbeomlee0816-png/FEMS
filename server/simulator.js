'use strict';

/**
 * 계측 데이터 시뮬레이터 / 연동 예제.
 *
 * 목적 2가지:
 *  1) 지금 당장 대시보드가 동작하는 모습을 보여주기 위한 테스트 데이터 생성
 *  2) 나중에 붙일 "소스를 주는 프로그램" 이 어떻게 연결하면 되는지에 대한 예제 코드
 *     → 핵심은 POST /api/ingest 로 { readings: [...] } 를 주기적으로 보내는 것뿐이다.
 *
 * 사용법:
 *   node server/simulator.js          # 실시간 스트리밍 (Ctrl+C 로 중지)
 *   node server/simulator.js --seed   # 포인트 등록 + 1회 배치 후 종료
 */

const BASE = process.env.MONITOR_URL || 'http://localhost:3000';

// K5/K3/K4 사업장에 전력계측기·유량계 포인트 정의.
// 일부는 의도적으로 이상 상황을 만들어 알람 3단계(경고/주의/긴급)를 시연한다.
const POINTS = [
  // 정상 전력계측기
  { point_key: 'K5-PWR-001', site: 'K5', name: 'K5 메인 수전', type: 'power', unit: 'kW', expected_interval_sec: 60, max_normal: 1200, peak_threshold: 1000 },
  { point_key: 'K5-PWR-002', site: 'K5', name: 'K5 생산라인A', type: 'power', unit: 'kW', expected_interval_sec: 60, max_normal: 800, peak_threshold: 700 },
  { point_key: 'K5-FLW-001', site: 'K5', name: 'K5 냉각수 유량', type: 'flow', unit: 'm³/h', expected_interval_sec: 60, max_normal: 500 },
  { point_key: 'K3-PWR-001', site: 'K3', name: 'K3 메인 수전', type: 'power', unit: 'kW', expected_interval_sec: 60, max_normal: 1000, peak_threshold: 850 },
  { point_key: 'K3-PWR-002', site: 'K3', name: 'K3 유틸리티동', type: 'power', unit: 'kW', expected_interval_sec: 60, max_normal: 600 },
  { point_key: 'K4-PWR-001', site: 'K4', name: 'K4 메인 수전', type: 'power', unit: 'kW', expected_interval_sec: 60, max_normal: 900, peak_threshold: 800 },
  { point_key: 'K4-FLW-001', site: 'K4', name: 'K4 압축공기 유량', type: 'flow', unit: 'm³/h', expected_interval_sec: 60, max_normal: 300 },

  // 이상 시연용 포인트
  { point_key: 'K5-PWR-OFF', site: 'K5', name: 'K5 설비 정지(가동중단)', type: 'power', unit: 'kW', expected_interval_sec: 60, peak_threshold: 500 }, // 유효전력 Zero
  { point_key: 'K3-PWR-STK', site: 'K3', name: 'K3 통신불량(동일값)', type: 'power', unit: 'kW', expected_interval_sec: 60, max_normal: 700 }, // 동일값 지속
  { point_key: 'K4-PWR-DEAD', site: 'K4', name: 'K4 미수신(전원차단)', type: 'power', unit: 'kW', expected_interval_sec: 60 }, // 미수신
];

const nowIso = () => new Date().toISOString();
const rnd = (a, b) => a + Math.random() * (b - a);

async function post(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function registerPoints() {
  const r = await post('/api/points', POINTS);
  console.log(`포인트 등록 완료: ${r.count}개`);
}

let tick = 0;
function buildBatch() {
  tick++;
  const readings = [];
  for (const p of POINTS) {
    // K4-PWR-DEAD: 데이터를 아예 보내지 않아 "미수신" 상황 연출
    if (p.point_key === 'K4-PWR-DEAD') continue;

    let value, effective_power;
    if (p.point_key === 'K5-PWR-OFF') {
      // 유효전력 Zero 지속 (설비 미가동)
      value = 0;
      effective_power = 0;
    } else if (p.point_key === 'K3-PWR-STK') {
      // 동일 값 지속 (통신 끊김/집계 오류 의심)
      value = 512.0;
      effective_power = 512.0;
    } else if (p.type === 'power') {
      const base = (p.max_normal || 500) * 0.7;
      // K5-PWR-001 은 가끔 피크 초과로 튀게 함
      const spike = p.point_key === 'K5-PWR-001' && tick % 7 === 0 ? 1.4 : 1;
      value = Math.round(rnd(base * 0.85, base * 1.05) * spike * 10) / 10;
      effective_power = value;
    } else {
      value = Math.round(rnd((p.max_normal || 300) * 0.5, (p.max_normal || 300) * 0.8) * 10) / 10;
    }
    readings.push({ point_key: p.point_key, ts: nowIso(), value, effective_power });
  }
  return readings;
}

async function main() {
  const seedOnly = process.argv.includes('--seed');
  await registerPoints();

  const send = async () => {
    const readings = buildBatch();
    const r = await post('/api/ingest', { readings });
    console.log(`[${nowIso()}] 전송 ${readings.length}건 → 수집 ${r.accepted} / 거부 ${r.rejected}`);
  };

  await send();
  if (seedOnly) {
    console.log('시드 완료. (--seed)');
    return;
  }

  console.log('실시간 스트리밍 시작 (10초 주기). Ctrl+C 로 중지.');
  setInterval(send, 10000);
}

main().catch((e) => {
  console.error('시뮬레이터 오류:', e.message);
  console.error('먼저 서버를 실행하세요:  npm start');
  process.exit(1);
});
