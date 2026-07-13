'use strict';

// FEMS 통합 관제 대시보드 - 폴링 기반 실시간 갱신
const SEV_CLASS = { 긴급: 'urgent', 주의: 'caution', 경고: 'warn' };
let sevFilter = '';
let autoTimer = null;

const $ = (s) => document.querySelector(s);
async function getJSON(url) {
  const r = await fetch(url);
  return r.json();
}

function fmtTs(ts) {
  if (!ts) return '-';
  const d = new Date(/[zZ]/.test(ts) ? ts : ts.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ko-KR', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── 전체 요약 ──────────────────────────────────────────────
function renderSummary(d) {
  const s = d.summary;
  const rClass = s.reception_rate >= d.target_reception ? '' : s.reception_rate >= 90 ? 'sev-caution' : 'sev-urgent';
  $('#summary').innerHTML = `
    <div class="kpi"><div class="label">모니터링 사업장</div><div class="value">${s.sites}<small> 개소</small></div></div>
    <div class="kpi"><div class="label">전체 계측 포인트</div><div class="value">${s.points}<small> 개</small></div></div>
    <div class="kpi ${rClass}"><div class="label">전체 수신율 (목표 ${d.target_reception}%)</div><div class="value">${s.reception_rate}<small>%</small></div></div>
    <div class="kpi"><div class="label">정상 수신</div><div class="value">${s.online}<small> / ${s.points}</small></div></div>
    <div class="kpi sev-urgent"><div class="label">긴급 알람</div><div class="value">${s.active_alarms.긴급}</div></div>
    <div class="kpi sev-caution"><div class="label">주의 알람</div><div class="value">${s.active_alarms.주의}</div></div>
    <div class="kpi sev-warn"><div class="label">경고 알람</div><div class="value">${s.active_alarms.경고}</div></div>`;
}

// ── 사업장 카드 ────────────────────────────────────────────
function receptFillClass(rate) {
  if (rate >= 95) return '';
  if (rate >= 90) return 'warn';
  return 'bad';
}
function renderSites(sites) {
  $('#siteGrid').innerHTML = sites
    .map((s) => {
      const width = Math.max(0, Math.min(100, s.reception_rate));
      return `
      <div class="site-card">
        <div class="head"><h3>${s.name}</h3><span class="badge">${s.total} 포인트</span></div>
        <div class="body">
          <div class="metric-row"><span class="k">수신율</span><span class="v">${s.reception_rate}% <span class="muted">(${s.online}/${s.total})</span></span></div>
          <div class="recept-bar">
            <div class="fill ${receptFillClass(s.reception_rate)}" style="width:${width}%"></div>
            <div class="target" title="관리 목표 95~100%"></div>
          </div>
          <div class="bar-scale"><span>0%</span><span>95~100%</span></div>
          <div class="metric-row" style="margin-top:12px"><span class="k">데이터 정합성</span><span class="v">${s.integrity_rate}%</span></div>
          <div class="metric-row"><span class="k">SLA 준수율</span><span class="v" style="color:${s.sla_ok ? 'var(--ok)' : 'var(--sev-urgent)'}">${s.sla_compliance}%</span></div>
          <div class="sla-chips">
            <div class="chip warn"><span class="n">${s.alarms.경고}</span>경고</div>
            <div class="chip caution"><span class="n">${s.alarms.주의}</span>주의</div>
            <div class="chip urgent"><span class="n">${s.alarms.긴급}</span>긴급</div>
          </div>
        </div>
      </div>`;
    })
    .join('');
}

// ── 알람 목록 ──────────────────────────────────────────────
async function renderAlarms() {
  const q = sevFilter ? `?severity=${encodeURIComponent(sevFilter)}` : '';
  const d = await getJSON('/api/alarms' + q);
  const list = $('#alarmList');
  if (!d.alarms.length) {
    list.innerHTML = '<div class="empty">활성 알람이 없습니다. ✓</div>';
    return;
  }
  list.innerHTML = d.alarms
    .map((a) => {
      const c = SEV_CLASS[a.severity] || 'warn';
      return `
      <div class="alarm ${c}">
        <span class="sev-tag ${c}">${a.severity}</span>
        <div class="a-body">
          <div class="a-msg">${escapeHtml(a.message)}</div>
          <div class="a-meta">${a.site} · ${a.cause ? escapeHtml(a.cause) : a.code} · ${fmtTs(a.last_ts)} · 상태 ${a.status}</div>
        </div>
        <div class="a-actions">
          ${a.status === 'active' ? `<button onclick="ackAlarm(${a.id})">접수</button>` : ''}
          <button onclick="resolveAlarm(${a.id})">해제</button>
        </div>
      </div>`;
    })
    .join('');
}

window.ackAlarm = async (id) => { await fetch(`/api/alarms/${id}/ack`, { method: 'POST' }); renderAlarms(); };
window.resolveAlarm = async (id) => { await fetch(`/api/alarms/${id}/resolve`, { method: 'POST' }); refresh(); };

// ── 포인트 상태 ────────────────────────────────────────────
async function renderPoints() {
  const d = await getJSON('/api/points');
  $('#pointCount').textContent = `${d.count} 포인트`;
  $('#pointTbody').innerHTML = d.points
    .map((p) => {
      let statusPill = '<span class="pill ok">정상</span>';
      if (!p.online) statusPill = '<span class="pill urgent">미수신</span>';
      else if (p.worst_severity) statusPill = `<span class="pill ${SEV_CLASS[p.worst_severity]}">${p.worst_severity}</span>`;
      const val = p.last_value != null ? `${p.last_value}${p.unit || ''}` : '-';
      return `
      <tr>
        <td>${escapeHtml(p.name)}<div class="muted">${p.point_key}</div></td>
        <td>${p.site}</td>
        <td>${p.type === 'power' ? '전력' : '유량'}</td>
        <td><span class="dot ${p.online ? 'on' : 'off'}"></span>${p.online ? '수신' : '끊김'}</td>
        <td>${val}</td>
        <td>${statusPill}</td>
      </tr>`;
    })
    .join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function refresh() {
  try {
    const d = await getJSON('/api/dashboard');
    renderSummary(d);
    renderSites(d.sites);
    await Promise.all([renderAlarms(), renderPoints()]);
  } catch (e) {
    console.error('갱신 오류', e);
  }
}

function tickClock() {
  $('#clock').textContent = new Date().toLocaleString('ko-KR', { hour12: false });
}

// ── 이벤트 ─────────────────────────────────────────────────
$('#refreshBtn').addEventListener('click', refresh);
$('#sevFilter').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  sevFilter = e.target.dataset.sev;
  $('#sevFilter').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.target));
  renderAlarms();
});
function setupAuto() {
  const on = $('#autoToggle').checked;
  if (autoTimer) clearInterval(autoTimer);
  if (on) autoTimer = setInterval(refresh, 5000);
}
$('#autoToggle').addEventListener('change', setupAuto);

setInterval(tickClock, 1000);
tickClock();
refresh();
setupAuto();
