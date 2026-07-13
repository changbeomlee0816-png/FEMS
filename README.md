# FEMS 원격 모니터링 시스템

수서/유호스트 **FEMS SLA 제안서 12~13페이지**의 *「원격 모니터링 전략」* 및
*「모니터링 시스템 고도화 계획」* 을 바탕으로 구현한 **수신율·정합성 기반 통합 관제 시스템**입니다.

계측 데이터를 밀어넣는 외부 소스 프로그램은 나중에 붙일 수 있도록,
**데이터 수집(`POST /api/ingest`) 인터페이스를 표준화된 연동 지점**으로 설계했습니다.

---

## 핵심 기능 (제안서 매핑)

| 제안서 항목 (12~13p) | 구현 |
| --- | --- |
| **① 수신율** `정상수신 ÷ 전체등록 × 100` (목표 95~100%) | 포인트별 최근 수신 시각으로 온라인 판정 → 사업장/전체 수신율 산출, 95% 미달 시 자동 알람, 장기 미수신 포인트 추적 |
| **② 데이터 정합성** | 동일 값 지속(통신 끊김/집계 오류), 정상 범위 초과 이상치(결선/센서), 미수신 검증 |
| **③ 전력 피크·설비 가동** | 전력 피크 임계 초과, 유효전력 Zero 지속(30분~) 검출 |
| **3단계 심각도** 경고 → 주의 → 긴급 | 지표별 임계값 기반 자동 등급화 |
| **통합 대시보드** (K5·K3·K4) | 사업장별 수신율·정합성·SLA 준수율 한 화면 실시간 |
| **알람 자동 발송** | 심각도별 SMS·메신저·이메일 차등 발송 (채널 연동 지점 제공) |
| **이력 데이터 분석** | 원인코드별 재발 빈도·심각도 집계 리포트 |

3단계 심각도 색상 및 임계값 등 모든 운영 정책은 [`server/config.js`](server/config.js)
한 곳에서 조정합니다.

---

## 빠른 시작

```bash
npm install          # 최초 1회
npm start            # 모니터링 서버 실행 (http://localhost:3000)
```

브라우저에서 `http://localhost:3000` 접속 → 통합 관제 대시보드.

### 데모 데이터로 동작 확인

서버를 켠 상태에서 별도 터미널에서:

```bash
npm run simulate     # K5/K3/K4 계측 데이터 실시간 스트리밍 (Ctrl+C 중지)
# 또는
npm run seed         # 포인트 등록 + 1회 배치만 주입 후 종료
```

시뮬레이터는 일부러 이상 상황(미수신·동일값·유효전력 Zero·피크 초과)을 포함해
경고/주의/긴급 3단계 알람을 시연합니다. **이 시뮬레이터가 곧 외부 소스 프로그램의
연동 예제**입니다 (`server/simulator.js`).

---

## 외부 소스 프로그램 연동 방법

나중에 붙일 프로그램은 **계측값을 `POST /api/ingest` 로 주기 전송**하기만 하면 됩니다.

```bash
# 단건
curl -X POST http://localhost:3000/api/ingest \
  -H 'content-type: application/json' \
  -d '{"point_key":"K5-PWR-001","ts":"2026-07-13T09:00:00Z","value":812.5,"effective_power":812.5}'

# 배치 (권장)
curl -X POST http://localhost:3000/api/ingest \
  -H 'content-type: application/json' \
  -d '{"readings":[
        {"point_key":"K5-PWR-001","value":812.5,"effective_power":812.5},
        {"point_key":"K5-FLW-001","value":263.1}
      ]}'
```

- `ts` 생략 시 수신 시각(서버 기준)으로 저장됩니다.
- 미등록 포인트도 기본값으로 자동 등록됩니다(`AUTO_REGISTER=false` 로 비활성 가능).
- 포인트 메타(정상 범위·피크 임계·기대 주기)는 `POST /api/points` 로 미리 등록하면
  정합성/피크 판정 정확도가 올라갑니다.

---

## API 요약

| Method & Path | 설명 |
| --- | --- |
| `POST /api/ingest` | **계측값 수집 (외부 소스 연동 지점)** |
| `POST /api/points` | 계측 포인트 등록/수정 (단건 또는 배열) |
| `GET  /api/points` | 포인트 상태 목록 (`?site=K5`) |
| `GET  /api/points/:key` | 포인트 상세 + 최근 이력 |
| `GET  /api/dashboard` | 사업장별 수신율·정합성·SLA + 전체 요약 |
| `GET  /api/alarms` | 알람 목록 (`?status= &severity= &site= &category=`) |
| `POST /api/alarms/:id/ack` | 알람 접수(확인) |
| `POST /api/alarms/:id/resolve` | 알람 수동 해제 |
| `GET  /api/reports/recurrence` | 재발 패턴 (`?days=30`) |
| `GET  /api/reports/summary` | 심각도/카테고리 집계 |

---

## 포인트(계측기) 등록 필드

```jsonc
{
  "point_key": "K5-PWR-001",        // 외부 소스가 사용하는 고유 식별자 (필수)
  "site": "K5",                      // K5 | K3 | K4 ...
  "name": "K5 메인 수전",
  "type": "power",                   // power(전력계측기) | flow(유량계)
  "unit": "kW",
  "expected_interval_sec": 60,        // 기대 수신 주기 (수신율/미수신 판정 기준)
  "min_normal": 0, "max_normal": 1200, // 정상 범위 (정합성 판정)
  "peak_threshold": 1000              // 전력 피크 임계 (계약전력 등)
}
```

---

## 구조

```
server/
  index.js       서버 + 주기 모니터링 루프
  config.js      사업장·임계값·심각도·알람 정책 (운영 튜닝 지점)
  db.js          SQLite 스키마 (points/readings/alarms/notifications)
  store.js       포인트 등록 · 계측값 수집
  monitor.js     모니터링 엔진 (수신율·정합성·피크/Zero 판정)
  alarms.js      알람 생성/갱신/자동해제(dedup)
  notify.js      알람 자동 발송 (SMS/메신저/이메일 — 실제 연동 지점)
  simulator.js   데모 데이터 생성 & 연동 예제
  routes/api.js  REST API
public/          통합 관제 대시보드 (정적)
```

## 단계적 적용 (제안서 로드맵)

1차 K5 파일럿 → 2차 K3·K4 확장 → 3차 베트남·CEMS 연계.
사업장은 `server/config.js` 의 `sites` 배열에서 `active` 플래그로 관리합니다.

## 참고

- 실제 알람 발송을 켜려면 `NOTIFY_ENABLED=true` 및 `server/notify.js` 의
  `senders` 에 각 채널(문자 게이트웨이/메신저 Webhook/SMTP) 구현을 연결하세요.
- 하드웨어(전력계측기·유량계) A/S 는 협력사(가니·신아시스템) 연계 대상으로,
  본 시스템은 데이터 수신·정합성 관점의 SLA 관제를 담당합니다 (제안서 10p).
