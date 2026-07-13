'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'fems.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS points (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    point_key           TEXT NOT NULL UNIQUE,      -- 외부 소스가 사용하는 계측 포인트 식별자
    site                TEXT NOT NULL,             -- K5 / K3 / K4 ...
    name                TEXT NOT NULL,
    type                TEXT NOT NULL DEFAULT 'power', -- 'power'(전력계측기) | 'flow'(유량계)
    unit                TEXT DEFAULT '',
    expected_interval_sec INTEGER NOT NULL DEFAULT 60,
    min_normal          REAL,                      -- 정상 범위 하한
    max_normal          REAL,                      -- 정상 범위 상한
    peak_threshold      REAL,                      -- 전력 피크 임계값 (계약전력 등)
    active              INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS readings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    point_id        INTEGER NOT NULL,
    ts              TEXT NOT NULL,                 -- ISO8601 수신 시각
    value           REAL,
    effective_power REAL,                          -- 유효전력 (전력계측기), Zero 검출용
    quality         TEXT DEFAULT 'ok',
    FOREIGN KEY (point_id) REFERENCES points(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_readings_point_ts ON readings(point_id, ts);

  CREATE TABLE IF NOT EXISTS alarms (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    point_id     INTEGER,
    site         TEXT NOT NULL,
    category     TEXT NOT NULL,                    -- reception | integrity | peak | zero
    severity     TEXT NOT NULL,                    -- 경고 | 주의 | 긴급
    code         TEXT NOT NULL,                    -- 세부 원인 코드
    message      TEXT NOT NULL,
    cause        TEXT,                             -- 발생 원인 구분
    status       TEXT NOT NULL DEFAULT 'active',   -- active | ack | resolved
    dedup_key    TEXT NOT NULL,                    -- 동일 이상 중복 방지 키
    first_ts     TEXT NOT NULL DEFAULT (datetime('now')),
    last_ts      TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_ts  TEXT,
    dispatched   INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (point_id) REFERENCES points(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_alarms_status ON alarms(status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_alarms_active_dedup
    ON alarms(dedup_key) WHERE status != 'resolved';

  CREATE TABLE IF NOT EXISTS notifications (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    alarm_id  INTEGER,
    channel   TEXT NOT NULL,                       -- sms | messenger | email
    severity  TEXT NOT NULL,
    target    TEXT,
    body      TEXT,
    status    TEXT NOT NULL DEFAULT 'sent',
    ts        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (alarm_id) REFERENCES alarms(id) ON DELETE CASCADE
  );
`);

module.exports = db;
