'use strict';

/**
 * FEMS 원격 모니터링 시스템 - 전역 설정
 *
 * 제안서 12~13페이지의 "원격 모니터링 전략" 및 "모니터링 시스템 고도화 계획"에
 * 정의된 관리 목표/임계값을 코드로 옮긴 것이다. 운영 정책이 확정되면
 * 이 파일의 값만 조정하면 된다. (기준선 내부 협의 대상)
 */

const SEVERITY = {
  WARNING: '경고', // 가장 낮은 심각도
  CAUTION: '주의',
  URGENT: '긴급', // 가장 높은 심각도
};

// 심각도 정렬용 가중치 (높을수록 심각)
const SEVERITY_RANK = {
  [SEVERITY.WARNING]: 1,
  [SEVERITY.CAUTION]: 2,
  [SEVERITY.URGENT]: 3,
};

const CATEGORY = {
  RECEPTION: 'reception', // 수신율
  INTEGRITY: 'integrity', // 데이터 정합성
  PEAK: 'peak', // 전력 피크
  ZERO: 'zero', // 유효전력 Zero (설비 가동 중단)
};

module.exports = {
  SEVERITY,
  SEVERITY_RANK,
  CATEGORY,

  server: {
    port: Number(process.env.PORT) || 3000,
    // 모니터링 엔진 평가 주기 (초). 실시간 상시 모니터링.
    evalIntervalSec: Number(process.env.EVAL_INTERVAL_SEC) || 30,
    // 미등록 포인트로 데이터가 수신되면 기본값으로 자동 등록할지 여부.
    // 실제 소스 연동 초기에는 true 가 편하고, 운영 확정 후 false 권장.
    autoRegisterPoints: process.env.AUTO_REGISTER !== 'false',
  },

  // 다중 사업장 (12~13p: K5·K3·K4 통합 관제, 3차 베트남·CEMS 확장)
  sites: [
    { id: 'K5', name: 'K5 사업장', phase: 1, active: true },
    { id: 'K3', name: 'K3 사업장', phase: 2, active: true },
    { id: 'K4', name: 'K4 사업장', phase: 2, active: true },
    { id: 'VN', name: '베트남 (CEMS)', phase: 3, active: false },
  ],

  // ── 1) 수신율 (Reception Rate) ─────────────────────────────
  // 수신율(%) = 정상수신 ÷ 전체등록 × 100
  reception: {
    targetRate: 95, // 관리 목표 95~100% (100% 지향)
    // 최근 수신 시각이 (expected_interval_sec × staleFactor) 이내이면 "정상수신"
    staleFactor: 2.5,
    // 사업장 수신율(%) 구간별 심각도  (해당 값 미만일 때 발령)
    siteSeverity: [
      { below: 80, severity: SEVERITY.URGENT },
      { below: 90, severity: SEVERITY.CAUTION },
      { below: 95, severity: SEVERITY.WARNING },
    ],
    // 개별 포인트 장기 미수신 추적 (분). 초과 시 우선관리 대상.
    longOutageMinutes: 60,
    pointOutageSeverity: [
      { overMinutes: 180, severity: SEVERITY.URGENT },
      { overMinutes: 60, severity: SEVERITY.CAUTION },
      { overMinutes: 15, severity: SEVERITY.WARNING },
    ],
  },

  // ── 2) 데이터 정합성 (Data Integrity) ──────────────────────
  // 수치 이상, 결선(범위 이탈), 통신 끊김(동일값 지속) 등 논리·물리적 타당성 검증
  integrity: {
    // 동일 값이 N회 연속 계측되면 데이터 집계 오류 또는 통신 끊김 의심
    stuckCount: 5,
    stuckSeverity: [
      { overCount: 30, severity: SEVERITY.URGENT },
      { overCount: 12, severity: SEVERITY.CAUTION },
      { overCount: 5, severity: SEVERITY.WARNING },
    ],
    // 정상 범위(min~max) 초과 이상치. 심각도는 벗어난 정도(%)로 판정.
    outOfRangeSeverity: [
      { overPct: 50, severity: SEVERITY.URGENT },
      { overPct: 20, severity: SEVERITY.CAUTION },
      { overPct: 0, severity: SEVERITY.WARNING },
    ],
    // 정합성률(%) = (정합성 이상 없는 포인트 ÷ 전체등록) × 100
  },

  // ── 3) 전력 피크 / 설비 가동 (Peak / Zero) ─────────────────
  peakZero: {
    // 유효전력 사용량이 0으로 지속 검출될 경우 알람 (예: 30분~1시간 이상)
    // 지속시간(분) → 심각도
    zeroPowerSeverity: [
      { overMinutes: 120, severity: SEVERITY.URGENT },
      { overMinutes: 60, severity: SEVERITY.CAUTION },
      { overMinutes: 30, severity: SEVERITY.WARNING },
    ],
    // 전력 피크: 포인트별 peak_threshold(계약전력 등) 초과율(%) → 심각도
    peakSeverity: [
      { overPct: 20, severity: SEVERITY.URGENT },
      { overPct: 10, severity: SEVERITY.CAUTION },
      { overPct: 0, severity: SEVERITY.WARNING },
    ],
  },

  // ── SLA 준수율 ─────────────────────────────────────────────
  // 대시보드에서 사업장별 수신율·정합성·SLA 준수 현황을 한 화면에서 확인
  sla: {
    // 수신율 + 정합성률 가중 평균으로 단순 산출 (운영 정책 확정 시 조정)
    receptionWeight: 0.6,
    integrityWeight: 0.4,
    complianceTarget: 95,
  },

  // ── 알람 자동 발송 (13p) ───────────────────────────────────
  // 경고/주의/긴급 3단계 심각도별로 담당자에게 SMS·메신저·이메일 차등 발송
  notify: {
    enabled: process.env.NOTIFY_ENABLED === 'true', // 기본 false (콘솔/DB 기록만)
    channelsBySeverity: {
      [SEVERITY.WARNING]: ['email'],
      [SEVERITY.CAUTION]: ['email', 'messenger'],
      [SEVERITY.URGENT]: ['email', 'messenger', 'sms'],
    },
  },
};
