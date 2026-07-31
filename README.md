# FEMS 원격 모니터링 시스템 + SCADA 도면 제작

수서/유호스트 **FEMS SLA 제안서 12~13페이지**의 *「원격 모니터링 전략」* 및
*「모니터링 시스템 고도화 계획」* 을 바탕으로 구현한 **수신율·정합성 기반 통합 관제 시스템**입니다.

계측 데이터를 밀어넣는 외부 소스 프로그램은 나중에 붙일 수 있도록,
**데이터 수집(`POST /api/ingest`) 인터페이스를 표준화된 연동 지점**으로 설계했습니다.

여기에 더해, **「FEMS 수용가 등록 엑셀」을 올리면 SCADA 단선결선도 화면을 자동 생성하는
도면 제작 프로그램**이 함께 들어 있습니다.

| 화면 | 주소 | 내용 |
| --- | --- | --- |
| 통합 관제 대시보드 | `/` | 수신율·정합성·SLA·알람 |
| **SCADA 도면 제작** | **`/scada.html`** | **엑셀 업로드 → 셀 단위 검증 → 단선결선도 자동 생성 → FEMS 연동** |

SCADA 도면 제작 프로그램의 상세 문서: **[`docs/SCADA.md`](docs/SCADA.md)**

- 엑셀에 잘못된 값이 있으면 **`2)채널활성화 및 설비트리 D8` 처럼 셀 주소를 정확히 짚어**
  현재 값·문제·조치(오타면 근접값 제안까지)를 알려줍니다.
- **한전 메인은 한 업체에 두 개 이상** 가능합니다. 엑셀의 레벨 1 계통을 여러 개 넣거나,
  도면 화면에서 `＋ 한전메인 추가` 로 언제든 늘릴 수 있습니다.
- 도면의 계측 포인트는 기존 FEMS `points`·`POST /api/ingest`·모니터링 엔진과
  **같은 `point_key` 하나로 연결**되어, 나중에 FEMS 본 시스템에 그대로 이식됩니다.
- **양식을 화면에서 바로 내려받습니다.** 스키마에서 생성하므로 검증기와 어긋나지 않습니다.
- 전압·기기종류(VCB/ACB/TR/GEN/PV)·정격·차단용량·**보호계전요소(50/51·87T…)**·기기TAG·구역을
  적으면 실제 관제화면 수준의 단선결선도가 나오고, **PDF(A3 표제란 포함)** 로 내보낼 수 있습니다.
- 각 포인트에 **유효전력량(kWh)·전류(A)·전압(V)·역률(%) 4종이 기본 표시**되고,
  `표시 항목` 메뉴에서 전력품질·설비운전·열/가스/용수·환경 계측 항목을 더할 수 있습니다.
- 화면 하단 **알람·이벤트 바**(미확인/활성 건수, 확인 처리)와 **구역 탭**을 갖췄습니다.
- **`예시 SCADA 열어보기`** 버튼 하나로 업로드 없이 완성된 도면을 바로 볼 수 있습니다.

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
npm start            # 서버 실행 (http://localhost:3000)
```

- `http://localhost:3000` → 통합 관제 대시보드
- `http://localhost:3000/scada.html` → SCADA 도면 제작

### SCADA 도면 바로 만들어 보기

```bash
npm run sample       # 샘플 수용가 등록 엑셀 생성 (정상 / 오류 각 1개)
npm test             # 검증기·도면 생성기 회귀 테스트
```

`/scada.html` 에서 `test/fixtures/sample-good.xlsx` 를 올리면 한전 메인 2개짜리
단선결선도가 만들어지고, `sample-broken.xlsx` 를 올리면 셀 단위 오류 리포트를 볼 수 있습니다.

### 서버 없이 쓰기 · 공개 주소

**<https://changbeomlee0816-png.github.io/FEMS/scada.html>** — 설치 없이 바로 사용

```bash
npm run build:standalone   # → dist/scada-standalone.html
npm run build:pages        # → docs/scada.html (GitHub Pages 서비스 파일)
```

브라우저만으로 전 과정(엑셀 파싱·검증·도면 생성·편집)이 도는 단일 HTML 파일입니다.
서버판과 **같은 `server/scada/*.js` 로직을 그대로** 감싸 넣고, exceljs 자리에만
브라우저 XLSX 리더를 끼웠기 때문에 검증 결과가 서버와 완전히 일치합니다.

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
  scada/         SCADA 도면 제작 (엑셀 파싱·검증·도면 생성·FEMS 연동)
  routes/scada.js  도면 API
public/
  index.html     통합 관제 대시보드
  scada.html     SCADA 도면 제작 화면
test/            샘플 엑셀 생성기 + 회귀 테스트
```

SCADA 도면 제작 부분의 상세 구조와 연동 규격은 [`docs/SCADA.md`](docs/SCADA.md) 참고.

## 단계적 적용 (제안서 로드맵)

1차 K5 파일럿 → 2차 K3·K4 확장 → 3차 베트남·CEMS 연계.
사업장은 `server/config.js` 의 `sites` 배열에서 `active` 플래그로 관리합니다.

## 참고

- 실제 알람 발송을 켜려면 `NOTIFY_ENABLED=true` 및 `server/notify.js` 의
  `senders` 에 각 채널(문자 게이트웨이/메신저 Webhook/SMTP) 구현을 연결하세요.
- 하드웨어(전력계측기·유량계) A/S 는 협력사(가니·신아시스템) 연계 대상으로,
  본 시스템은 데이터 수신·정합성 관점의 SLA 관제를 담당합니다 (제안서 10p).
