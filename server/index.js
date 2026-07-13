'use strict';

const path = require('path');
const express = require('express');
const config = require('./config');
const monitor = require('./monitor');
const api = require('./routes/api');

const app = express();
app.use(express.json({ limit: '5mb' }));

// 정적 대시보드
app.use(express.static(path.join(__dirname, '..', 'public')));

// 상태 점검
app.get('/healthz', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// API
app.use('/api', api);

// 주기적 모니터링 평가 루프 (실시간 상시 모니터링)
let timer = null;
function startMonitorLoop() {
  const run = () => {
    try {
      monitor.evaluate();
    } catch (e) {
      console.error('[monitor] 평가 오류:', e);
    }
  };
  run();
  timer = setInterval(run, config.server.evalIntervalSec * 1000);
}

const server = app.listen(config.server.port, () => {
  console.log(`FEMS 원격 모니터링 시스템 실행 중: http://localhost:${config.server.port}`);
  console.log(`  · 대시보드      : http://localhost:${config.server.port}/`);
  console.log(`  · 데이터 수집    : POST /api/ingest`);
  console.log(`  · 평가 주기      : ${config.server.evalIntervalSec}s`);
  startMonitorLoop();
});

function shutdown() {
  if (timer) clearInterval(timer);
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
