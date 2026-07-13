'use strict';

const db = require('./db');
const config = require('./config');

/**
 * 알람 자동 발송 (제안서 13p).
 * 경고/주의/긴급 3단계 심각도별로 SMS·메신저·이메일 채널을 차등 적용한다.
 *
 * 실제 발송 연동(문자 게이트웨이, 사내 메신저 Webhook, SMTP 등)은 아래
 * senders 맵에 구현체를 끼워 넣기만 하면 된다. 기본값은 콘솔 로깅 + DB 기록.
 */

const senders = {
  sms: async (msg) => logSend('sms', msg),
  messenger: async (msg) => logSend('messenger', msg),
  email: async (msg) => logSend('email', msg),
};

function logSend(channel, msg) {
  // 실제 연동 시 이 부분을 각 채널 API 호출로 교체
  console.log(`[NOTIFY:${channel}] ${msg.severity} | ${msg.body}`);
  return { ok: true };
}

const insertNoti = db.prepare(`
  INSERT INTO notifications (alarm_id, channel, severity, target, body, status)
  VALUES (?, ?, ?, ?, ?, ?)
`);

/**
 * 알람 1건을 심각도에 맞는 채널들로 발송한다.
 * @param {object} alarm  alarms 테이블 레코드
 */
function dispatch(alarm) {
  const channels = config.notify.channelsBySeverity[alarm.severity] || ['email'];
  const body = `[${alarm.site}] ${alarm.message}`;

  for (const channel of channels) {
    let status = 'logged';
    if (config.notify.enabled && senders[channel]) {
      try {
        senders[channel]({ severity: alarm.severity, body });
        status = 'sent';
      } catch (e) {
        status = 'failed';
      }
    } else {
      // 발송 비활성화 상태 - 기록만 남김
      logSend(channel, { severity: alarm.severity, body });
    }
    insertNoti.run(alarm.id, channel, alarm.severity, null, body, status);
  }
}

module.exports = { dispatch, senders };
