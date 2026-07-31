/* global window, document */
'use strict';

/**
 * SCADA 도면 제작 프로그램 — 화면 조립.
 *
 * 흐름: 엑셀 업로드 → 검증 리포트 → 도면 저장 → 도면 편집/대시보드 → FEMS 포인트 등록.
 */
(function () {
  const api = window.ScadaApi;
  const Canvas = window.ScadaCanvas;
  const Charts = window.ScadaCharts;
  const Report = window.ScadaReport;
  const Sym = window.ScadaSymbols;
  const esc = Sym.esc;
  const fmt = Charts.fmt;

  const $ = (id) => document.getElementById(id);
  const els = {};
  [
    'tabs', 'projectSelect', 'clock', 'dropzone', 'fileInput', 'tolerantChk', 'schemaBtn',
    'tplExampleBtn', 'tplBlankBtn', 'uploadStatus', 'reportPanel', 'reportFilter', 'reportLead', 'reportBody', 'reportTable',
    'cntAll', 'cntError', 'cntWarn', 'cntInfo', 'copyReportBtn', 'saveProjectBtn',
    'projectList', 'schemaPanel', 'schemaBody', 'mainStrip', 'canvas', 'sld', 'legend',
    'inspector', 'inspectorBody', 'addMainBtn', 'addLoadBtn', 'deleteNodeBtn',
    'zoomInBtn', 'zoomOutBtn', 'fitBtn', 'relayoutBtn', 'liveChk', 'demoBtn',
    'openExampleBtn', 'zoneBar', 'alarmBar', 'alarmBody', 'alarmCounts', 'ackAllBtn',
    'exportPdfBtn', 'exportSvgBtn', 'exportJsonBtn', 'saveBtn', 'loadChart', 'groupChart', 'siteInfo',
    'facilityBody', 'facilityCount', 'pointsBody', 'pointsCount', 'publishBtn', 'toast',
  ].forEach((id) => (els[id] = $(id)));

  const state = {
    view: 'upload',
    project: null,
    pendingFile: null,
    dirty: false,
    liveTimer: null,
    zone: '',              // 선택된 구역코드 ('' = 전체)
    acked: new Set(),      // 확인 처리한 알람 키
  };

  // ── 공통 UI ────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(message, kind) {
    els.toast.textContent = message;
    els.toast.className = 'sc-toast' + (kind ? ` is-${kind}` : '');
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.hidden = true), 3600);
  }

  function status(message, kind) {
    if (!message) {
      els.uploadStatus.hidden = true;
      return;
    }
    els.uploadStatus.innerHTML = message;
    els.uploadStatus.className = 'sc-status' + (kind ? ` is-${kind}` : '');
    els.uploadStatus.hidden = false;
  }

  function setView(view) {
    state.view = view;
    for (const btn of els.tabs.querySelectorAll('button')) btn.classList.toggle('active', btn.dataset.view === view);
    for (const name of ['upload', 'editor', 'dashboard', 'points']) $(`view-${name}`).hidden = name !== view;
    if (view === 'editor') setTimeout(() => Canvas.fit(), 30);
    if (view === 'dashboard') renderDashboard();
    if (view === 'points') renderPoints();
  }

  function tick() {
    els.clock.textContent = new Date().toLocaleString('ko-KR', { hour12: false });
  }

  // ── 업로드 ─────────────────────────────────────────────────────
  async function handleFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
      status('❌ <div><strong>.xlsx 파일만 업로드할 수 있습니다.</strong><br>엑셀에서 “다른 이름으로 저장 → Excel 통합 문서(.xlsx)” 로 저장한 뒤 다시 시도하세요.</div>', 'error');
      return;
    }

    state.pendingFile = file;
    els.dropzone.classList.add('is-busy');
    status(`<div>📄 <strong>${esc(file.name)}</strong> 분석 중…</div>`);
    els.saveProjectBtn.disabled = true;

    try {
      const res = await api.preview(file, { tolerant: els.tolerantChk.checked });
      els.reportPanel.hidden = false;
      Report.render(res.report, els);

      const e = res.report.errorCount;
      const w = res.report.warningCount;
      if (e === 0) {
        status(
          `✅ <div><strong>${esc(file.name)} — 검증 통과</strong><br>` +
            `아래 “이 도면 저장하고 열기” 를 누르면 SCADA 도면이 생성됩니다.` +
            (w ? ` (확인이 필요한 항목 ${w}건은 도면 생성에는 영향을 주지 않습니다.)` : '') +
            '</div>',
          'ok'
        );
        els.saveProjectBtn.disabled = false;
      } else {
        status(
          `❌ <div><strong>${esc(file.name)} — 오류 ${e}건</strong><br>` +
            '아래 표의 <strong>셀 주소</strong>를 엑셀에서 찾아 수정한 뒤 다시 업로드하세요. ' +
            '구조만 먼저 확인하려면 “오류가 있어도 도면 미리보기 생성” 을 켜고 다시 올리면 됩니다.</div>',
          'error'
        );
        els.saveProjectBtn.disabled = !els.tolerantChk.checked;
      }
    } catch (err) {
      status(`❌ <div><strong>업로드 실패</strong><br>${esc(err.message)}</div>`, 'error');
    } finally {
      els.dropzone.classList.remove('is-busy');
    }
  }

  async function saveProject() {
    if (!state.pendingFile) return;
    els.saveProjectBtn.disabled = true;
    try {
      const res = await api.import(state.pendingFile, { tolerant: els.tolerantChk.checked });
      if (!res.project) {
        toast(res.message || '도면을 만들 수 없습니다.', 'error');
        els.saveProjectBtn.disabled = false;
        return;
      }
      toast('도면을 저장했습니다.', 'ok');
      await loadProjects();
      await openProject(res.project.id);
      setView('editor');
    } catch (err) {
      toast(err.message, 'error');
      els.saveProjectBtn.disabled = false;
    }
  }

  // ── 프로젝트 ───────────────────────────────────────────────────
  async function loadProjects() {
    const { projects } = await api.listProjects();
    els.projectSelect.innerHTML =
      '<option value="">— 도면 선택 —</option>' +
      projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    if (state.project) els.projectSelect.value = String(state.project.id);

    els.projectList.innerHTML = projects.length
      ? projects
          .map(
            (p) => `<li data-id="${p.id}">
              <div class="pl-main">
                <div class="pl-name">${esc(p.name)}</div>
                <div class="pl-sub">${esc(p.company || p.factoryCode || '')} · ${new Date(p.updatedAt + 'Z').toLocaleDateString('ko-KR')}${p.publishedAt ? ' · FEMS 등록됨' : ''}</div>
              </div>
              <button class="pl-del" data-del="${p.id}" title="삭제" aria-label="삭제">✕</button>
            </li>`
          )
          .join('')
      : '<li><p class="sc-empty">저장된 도면이 없습니다.</p></li>';
  }

  async function openProject(id) {
    const project = await api.getProject(id);
    state.project = project;
    state.dirty = false;
    els.projectSelect.value = String(id);
    state.zone = '';
    state.acked = new Set();
    Canvas.setDiagram(project.diagram);
    renderZoneBar();
    renderMainStrip();
    renderLegend();
    renderInspector(null);
    await refreshLive();
  }

  function markDirty() {
    state.dirty = true;
    els.saveBtn.textContent = '저장 *';
  }

  async function saveDiagram() {
    if (!state.project) return;
    await api.saveDiagram(state.project.id, state.project.diagram, state.project.name);
    state.dirty = false;
    els.saveBtn.textContent = '저장';
    toast('도면을 저장했습니다.', 'ok');
  }

  // ── 한전 메인 KPI 스트립 ───────────────────────────────────────
  function renderMainStrip() {
    if (!state.project) return;
    const mains = state.project.diagram.nodes.filter((n) => n.kind === 'main');
    if (!mains.length) {
      els.mainStrip.innerHTML = '<p class="sc-empty">한전 메인이 없습니다. “＋ 한전메인 추가” 로 수전점을 만드세요.</p>';
      return;
    }

    els.mainStrip.innerHTML = mains
      .map((m) => {
        const rows = [
          ['유효전력', 'power', 'kW'],
          ['전류', 'current', 'A'],
          ['전압', 'voltage', 'V'],
          ['역률', 'pf', '%'],
          ['사용량', 'usage', 'kWh'],
        ]
          .map(([label, role, unit]) => {
            const d = m.display && m.display[role];
            const r = d ? Canvas.reading(d.key) : null;
            const stale = !r || r.stale;
            return `<div class="sc-mrow${stale ? ' is-stale' : ''}">
                <span class="k">${label}</span>
                <span class="v">${stale ? '--' : fmt(r.value)}</span>
                <span class="u">${esc((d && d.unit) || unit)}</span>
              </div>`;
          })
          .join('');

        const pd = m.display && m.display.power;
        const pr = pd ? Canvas.reading(pd.key) : null;
        const rated = Number(m.ratedPower) || 0;
        const pct = pr && !pr.stale && rated > 0 ? Math.min(140, (pr.value / rated) * 100) : 0;
        const meterCls = pct > 100 ? ' is-urgent' : pct > 90 ? ' is-warn' : '';

        return `<article class="sc-maincard${m.id === Canvas.selectedId ? ' is-selected' : ''}" data-id="${esc(m.id)}">
            <div class="sc-maincard-head">
              <span class="sc-maincard-name">${esc(m.name)}</span>
              <span class="sc-maincard-tag">${m.device ? `#${m.device.deviceId}/CH${m.channel}` : '계측 미연결'}</span>
            </div>
            <div class="sc-maincard-rows">${rows}</div>
            <div class="sc-meter">
              <div class="sc-meter-bar"><div class="sc-meter-fill${meterCls}" style="width:${Math.min(100, pct)}%"></div></div>
              <div class="sc-meter-cap">
                <span>계약전력 대비 ${pct ? fmt(pct) + '%' : '--'}</span>
                <span>${rated ? fmt(rated) + ' kW' : '계약전력 미설정'}</span>
              </div>
            </div>
          </article>`;
      })
      .join('');
  }

  /**
   * 구역 탭 — Amkor(변전동/기계전기실/P1F EAST) · ABB(OVERVIEW/6.9kV SWGR) 처럼
   * 큰 계통을 구역 단위로 나눠 본다. 구역 정보가 없는 도면에서는 숨긴다.
   */
  function renderZoneBar() {
    const d = state.project && state.project.diagram;
    const zones = (d && d.zones) || [];
    if (!zones.length) {
      els.zoneBar.hidden = true;
      state.zone = '';
      return;
    }
    els.zoneBar.hidden = false;
    const count = (code) => d.nodes.filter((n) => !code || n.zoneCode === code).length;
    els.zoneBar.innerHTML =
      `<button data-zone="" class="${state.zone === '' ? 'active' : ''}">전체 <b>${count('')}</b></button>` +
      zones
        .map((z) => `<button data-zone="${esc(z.code)}" class="${state.zone === z.code ? 'active' : ''}" title="${esc(z.note || '')}">${esc(z.name)} <b>${count(z.code)}</b></button>`)
        .join('');
  }

  /** 구역 선택 → 해당 구역 설비만 남기고 나머지는 흐리게 */
  function applyZone() {
    Canvas.setZone(state.zone);
    renderZoneBar();
  }

  // ── 알람 바 ────────────────────────────────────────────────────
  function renderAlarms() {
    if (!state.project) return;
    const live = Canvas.live || { values: {} };
    const res = window.ScadaAlarms.evaluate(state.project.diagram, live, state.acked);
    state.alarms = res;

    els.alarmCounts.innerHTML = res.unacked
      ? `<span class="n-unacked">미확인 ${res.unacked}</span><span class="n-active">활성 ${res.active}</span>`
      : res.active
        ? `<span class="n-active">활성 ${res.active}</span>`
        : '<span class="n-clear">정상</span>';

    const L = window.ScadaAlarms.LEVELS;
    els.alarmBody.innerHTML = res.items.length
      ? res.items
          .map(
            (a) => `<tr class="lv-${a.level}${a.acked ? ' is-acked' : ''}" data-node="${esc(a.nodeId)}" data-key="${esc(a.key)}">
              <td><span class="a-lv ${a.level}">${L[a.level].icon} ${L[a.level].label}</span></td>
              <td>${esc(a.zone)}</td>
              <td class="a-tag">${esc(a.tag)}</td>
              <td>${esc(a.name)} — ${esc(a.message)}</td>
              <td class="a-ts">${a.ts ? new Date(a.ts).toLocaleString('ko-KR', { hour12: false }) : '-'}</td>
              <td>${a.acked ? '<span class="sc-muted">확인됨</span>' : `<button class="a-ack" data-ack="${esc(a.key)}">확인</button>`}</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="sc-empty">활성 알람이 없습니다.</td></tr>';
  }

  function renderLegend() {
    els.legend.innerHTML = `
      <span><i style="background:var(--wire-live)"></i>가압/정상</span>
      <span><i style="background:var(--wire-dead)"></i>미수신·비가압</span>
      <span><i style="background:var(--wire-alarm)"></i>계약전력 초과</span>
      <span>□ 차단기 (채움=투입 / 빔=개방)</span>
      <span>드래그: 설비 이동 · 휠: 확대 · 빈 곳 드래그: 화면 이동</span>`;
  }

  // ── 속성 패널 ──────────────────────────────────────────────────
  function renderInspector(node) {
    els.deleteNodeBtn.disabled = !node;
    if (!node) {
      els.inspectorBody.innerHTML = '<p class="sc-empty">도면에서 설비를 선택하면 속성이 표시됩니다.</p>';
      return;
    }

    const kindLabel = { main: '한전 메인 (수전점)', group: '계통 (분기)', load: '부하 설비' }[node.kind] || node.kind;
    const symbolOptions = Sym.kinds
      .map((k) => `<option value="${k}"${k === node.symbol ? ' selected' : ''}>${esc(Sym.LABELS[k] || k)}</option>`)
      .join('');

    const pointRows = (node.points || [])
      .map((p) => {
        const r = Canvas.reading(p.key);
        const stale = !r || r.stale;
        return `<li>
            <span class="pn">${esc(p.name)}</span>
            <span class="pv${stale ? ' is-stale' : ''}">${stale ? '--' : fmt(r.value)} ${esc(p.unit || '')}</span>
          </li>`;
      })
      .join('');

    els.inspectorBody.innerHTML = `
      <div class="sc-subhead">${esc(kindLabel)}</div>
      <div class="sc-field"><label for="fName">이름</label><input id="fName" value="${esc(node.name)}" /></div>
      <div class="sc-field"><label for="fSymbol">심볼</label><select id="fSymbol">${symbolOptions}</select></div>
      <div class="sc-field"><label for="fRated">${node.kind === 'main' ? '계약전력 (kW)' : '정격출력 (kW)'}</label>
        <input id="fRated" type="number" step="0.1" value="${node.ratedPower != null ? node.ratedPower : ''}" placeholder="미설정" /></div>
      ${node.kind === 'main'
        ? `<div class="sc-field"><label for="fCapacity">수전용량 (kW)</label>
             <input id="fCapacity" type="number" step="0.1" value="${node.capacity != null ? node.capacity : ''}" placeholder="미설정" /></div>`
        : ''}

      <div class="sc-subhead">계측 연결</div>
      <dl class="sc-kv">
        <div class="sc-kv-row"><dt>장비</dt><dd>${node.device ? `#${node.device.deviceId} ${esc(node.device.productName || '')}` : '미연결'}</dd></div>
        <div class="sc-kv-row"><dt>IP / 채널</dt><dd>${node.device ? `${esc(node.device.ip || '-')} / CH${node.channel}` : '-'}</dd></div>
        <div class="sc-kv-row"><dt>설치 위치</dt><dd>${esc((node.device && node.device.location) || '-')}</dd></div>
        <div class="sc-kv-row"><dt>설비코드</dt><dd>${esc((node.facility && node.facility.equipmentCode) || '-')}</dd></div>
        <div class="sc-kv-row"><dt>설비그룹</dt><dd>${esc((node.facility && node.facility.groupName) || '-')}</dd></div>
        <div class="sc-kv-row"><dt>에너지원</dt><dd>${esc(node.energySourceName || '-')}</dd></div>
      </dl>

      <div class="sc-subhead">계측 포인트 (${(node.points || []).length})</div>
      ${pointRows ? `<ul class="sc-pointlist">${pointRows}</ul>` : '<p class="sc-empty">연결된 포인트가 없습니다.</p>'}
    `;

    const bind = (id, apply) => {
      const el = $(id);
      if (el) el.addEventListener('change', () => { apply(el.value); Canvas.render(); renderMainStrip(); markDirty(); });
    };
    bind('fName', (v) => { node.name = v.trim() || node.name; });
    bind('fSymbol', (v) => { node.symbol = v; });
    bind('fRated', (v) => { node.ratedPower = v === '' ? null : Number(v); });
    bind('fCapacity', (v) => { node.capacity = v === '' ? null : Number(v); });
  }

  // ── 도면 편집 동작 ─────────────────────────────────────────────
  async function addMain() {
    if (!state.project) return toast('먼저 도면을 여세요.', 'error');
    if (state.dirty) await saveDiagram();
    const res = await api.addMain(state.project.id, {});
    await openProject(state.project.id);
    Canvas.select(res.node.id);
    renderMainStrip();
    toast(`한전 메인을 추가했습니다. (총 ${res.mains}개)`, 'ok');
  }

  function addLoad() {
    if (!state.project) return toast('먼저 도면을 여세요.', 'error');
    const d = state.project.diagram;
    const parent = d.nodes.find((n) => n.id === Canvas.selectedId) || d.nodes.find((n) => n.kind === 'main');
    if (!parent) return toast('상위 계통이 없습니다. 먼저 한전메인을 추가하세요.', 'error');

    const nextId = Math.max(0, ...d.nodes.map((n) => n.systemId || 0)) + 1;
    const siblings = d.nodes.filter((n) => n.parent === parent.id);
    const node = {
      id: `n${nextId}`,
      systemId: nextId,
      mainId: parent.mainId || parent.id,
      kind: 'load',
      symbol: 'load',
      name: `신규 부하 ${nextId}`,
      depth: (parent.depth || 1) + 1,
      x: siblings.length ? Math.max(...siblings.map((s) => s.x)) + d.layout.LEAF_W : parent.x,
      y: parent.y + d.layout.LANE_H,
      w: d.layout.NODE_W,
      h: d.layout.NODE_H,
      parent: parent.id,
      energySource: parent.energySource,
      energySourceName: parent.energySourceName,
      device: null, channel: null, facility: null,
      ratedPower: null, capacity: null,
      points: [], display: {}, locked: false, source: 'manual',
    };
    // 부모가 부하였다면 분기 계통으로 승격
    if (parent.kind === 'load') parent.kind = 'group';
    d.nodes.push(node);
    Canvas.render();
    Canvas.select(node.id);
    markDirty();
  }

  function deleteSelected() {
    if (!state.project || !Canvas.selectedId) return;
    const d = state.project.diagram;
    const target = d.nodes.find((n) => n.id === Canvas.selectedId);
    if (!target) return;

    const doomed = new Set([target.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of d.nodes) {
        if (n.parent && doomed.has(n.parent) && !doomed.has(n.id)) {
          doomed.add(n.id);
          grew = true;
        }
      }
    }
    const label = doomed.size > 1 ? `'${target.name}' 과(와) 하위 ${doomed.size - 1}개 설비` : `'${target.name}'`;
    if (!window.confirm(`${label} 을(를) 도면에서 삭제할까요?`)) return;

    d.nodes = d.nodes.filter((n) => !doomed.has(n.id));
    d.edges = (d.edges || []).filter((e) => !doomed.has(e.from) && !doomed.has(e.to));
    d.dashboard.mainCards = (d.dashboard.mainCards || []).filter((c) => !doomed.has(c.nodeId));
    Canvas.select(null);
    Canvas.render();
    renderMainStrip();
    markDirty();
  }

  /** 파일 저장. 문자열·바이트 모두 받는다 (PDF·XLSX 는 바이트). */
  async function download(filename, data, mime) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    // 게시된 페이지에서는 호스트가 제공하는 저장 경로를 먼저 쓴다.
    // (일반 서버 실행 시에는 존재하지 않으므로 곧바로 아래 앵커 방식으로 내려간다)
    if (window.claude && window.claude.downloads) {
      try {
        await window.claude.downloads.save({ filename, data: bytes });
        return;
      } catch (e) {
        if (e && e.code === 'user_rejected') return;
      }
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  // ── 실시간 값 ──────────────────────────────────────────────────
  async function refreshLive() {
    if (!state.project) return;
    try {
      const live = await api.live(state.project.id);
      Canvas.setLive(live);
      renderMainStrip();
      renderAlarms();
      if (state.view === 'dashboard') renderDashboard();
      const sel = state.project.diagram.nodes.find((n) => n.id === Canvas.selectedId);
      if (sel) renderInspector(sel);
    } catch (e) {
      /* 폴링 실패는 조용히 넘긴다 — 다음 주기에 회복된다 */
    }
  }

  function setLivePolling(on) {
    clearInterval(state.liveTimer);
    state.liveTimer = null;
    if (on) {
      refreshLive();
      state.liveTimer = setInterval(refreshLive, 5000);
    }
  }

  // ── 대시보드 ───────────────────────────────────────────────────
  function renderDashboard() {
    if (!state.project) return;
    const d = state.project.diagram;
    const site = state.project.model.site;

    // 계통별 부하는 레벨2 분기만 비교한다. 한전메인(수천 kW)을 같은 축에 섞으면
    // 개별 계통 막대가 눌려서 보이지 않는다 — 메인 현황은 상단 KPI 스트립이 담당한다.
    const branches = d.nodes.filter((n) => n.depth === 2);
    const targets = branches.length ? branches : d.nodes.filter((n) => n.kind === 'main');
    const loadData = targets.map((n) => {
      const pd = n.display && n.display.power;
      const r = pd ? Canvas.reading(pd.key) : null;
      return { name: n.name, value: r && !r.stale ? r.value : 0, reference: Number(n.ratedPower) || 0 };
    });
    Charts.groupedBars(els.loadChart, loadData, { unit: 'kW', series1: '현재 유효전력', series2: '정격/계약전력' });

    // 설비그룹별 설비 수는 데이터 입력 통계일 뿐 관제에 쓸모가 없어서 뺐다.
    // 그 자리에 관제화면이 실제로 보는 것 — 구역별 알람 건수를 넣는다.
    const alarms = window.ScadaAlarms.evaluate(d, Canvas.live || { values: {} }, state.acked);
    const byZone = new Map();
    for (const a of alarms.items) {
      if (a.level === 'info') continue;
      byZone.set(a.zone, (byZone.get(a.zone) || 0) + 1);
    }
    const zoneData = [...byZone.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    Charts.horizontalBars(els.groupChart, zoneData, { unit: '건', title: '구역별 활성 알람' });

    els.siteInfo.innerHTML = [
      ['회사명', site.company],
      ['공장코드', site.factoryCode],
      ['업종', site.industry],
      ['요금제', site.tariff],
      ['요금적용전력', site.contractPower != null ? `${fmt(site.contractPower)} kW` : null],
      ['수전용량', site.receivingCapacity != null ? `${fmt(site.receivingCapacity)} kW` : null],
      ['담당자', site.manager && site.manager.name],
      ['연락처', site.manager && site.manager.mobile],
      ['계측 장비', `${state.project.model.devices.length} 대`],
      ['설비 채널', `${state.project.model.channels.length} 개`],
    ]
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `<div class="sc-kv-row"><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`)
      .join('');

    const loads = d.nodes.filter((n) => n.kind !== 'main');
    els.facilityCount.textContent = `${loads.length}개`;
    els.facilityBody.innerHTML = loads
      .map((n) => {
        const pd = n.display && n.display.power;
        const r = pd ? Canvas.reading(pd.key) : null;
        return `<tr>
            <td>${esc(n.name)}</td>
            <td>${esc((n.facility && n.facility.groupName) || '-')}</td>
            <td>${esc((n.facility && n.facility.equipmentCode) || '-')}</td>
            <td>${n.device ? `#${n.device.deviceId} ${esc(n.device.productName || '')}` : '-'}</td>
            <td>${n.channel != null ? `CH${n.channel}` : '-'}</td>
            <td class="sc-num">${r && !r.stale ? fmt(r.value) + ' kW' : '--'}</td>
          </tr>`;
      })
      .join('');
  }

  // ── 연동 포인트 ────────────────────────────────────────────────
  async function renderPoints() {
    if (!state.project) return;
    const { points } = await api.points(state.project.id);
    els.pointsCount.textContent = `${points.length}개 · 접두 ${state.project.factoryCode || ''}`;
    els.pointsBody.innerHTML = points
      .map(
        (p) => `<tr>
          <td><code>${esc(p.key)}</code></td>
          <td>${esc(p.nodeName)}</td>
          <td>${esc(p.name)}</td>
          <td>${esc(p.unit || '-')}</td>
          <td>${esc((p.roles || []).join(', ') || '-')}</td>
          <td>#${p.deviceId} / CH${p.channel}</td>
          <td><code>${esc(String(p.address || '-'))}</code></td>
        </tr>`
      )
      .join('');
  }

  // ── 양식 안내 ──────────────────────────────────────────────────
  async function showSchema() {
    els.schemaPanel.hidden = !els.schemaPanel.hidden;
    if (els.schemaPanel.hidden || els.schemaBody.dataset.loaded) return;
    const s = await api.schema();
    const cols = (list) => `<ul>${list.map((c) => `<li>${c.required ? '<span class="req">*</span> ' : ''}<code>${esc(c.col)}</code> ${esc(c.label)}</li>`).join('')}</ul>`;
    els.schemaBody.innerHTML = `
      <h3>필수 시트</h3><ul>${s.requiredSheets.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <h3>0)기본정보 (셀 고정)</h3>
      <ul>${s.basicFields.map((f) => `<li>${f.required ? '<span class="req">*</span> ' : ''}<code>${esc(f.cell)}</code> ${esc(f.label)}</li>`).join('')}</ul>
      <h3>1)장비 (3행부터)</h3>${cols(s.deviceColumns)}
      <h3>2)채널활성화 및 설비트리 (3행부터)</h3>${cols(s.channelColumns)}
      <h3>3)에너지트리 (3행부터)</h3>${cols(s.energyTreeColumns)}
      <h3>4)장비속성 (4행부터)</h3>${cols(s.deviceProfileColumns)}
      <h3>설비코드</h3><p>${s.codeTables.equipment.map(esc).join(' · ')}</p>
      <h3>에너지원 코드</h3><p>${s.codeTables.energySources.map((e) => `${e.code}=${esc(e.name)}`).join(' · ')}</p>`;
    els.schemaBody.dataset.loaded = '1';
  }

  // ── 이벤트 배선 ────────────────────────────────────────────────
  function wire() {
    els.tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.view !== 'upload' && !state.project) return toast('먼저 엑셀을 업로드하거나 저장된 도면을 여세요.', 'error');
      setView(btn.dataset.view);
    });

    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
    });
    els.fileInput.addEventListener('change', () => handleFile(els.fileInput.files[0]));
    ['dragenter', 'dragover'].forEach((t) =>
      els.dropzone.addEventListener(t, (e) => { e.preventDefault(); els.dropzone.classList.add('is-over'); })
    );
    ['dragleave', 'drop'].forEach((t) =>
      els.dropzone.addEventListener(t, (e) => { e.preventDefault(); els.dropzone.classList.remove('is-over'); })
    );
    els.dropzone.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

    els.reportFilter.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      for (const b of els.reportFilter.querySelectorAll('button')) b.classList.toggle('active', b === btn);
      Report.setFilter(btn.dataset.level, els);
    });
    els.copyReportBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(Report.asText());
        toast('검증 결과를 클립보드에 복사했습니다.', 'ok');
      } catch (e) {
        toast('복사에 실패했습니다. 표를 직접 선택해 복사하세요.', 'error');
      }
    });
    /** 양식 다운로드 — 스키마·코드표에서 만들어지므로 항상 검증기와 일치한다 */
    async function grabTemplate(mode, btn) {
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = '만드는 중…';
      try {
        const bytes = await api.template(mode);
        const name = mode === 'blank' ? 'FEMS_수용가등록_양식.xlsx' : 'FEMS_수용가등록_양식_예시.xlsx';
        await download(name, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        toast(mode === 'blank' ? '빈 양식을 내려받았습니다.' : '기입 예시가 포함된 양식을 내려받았습니다.', 'ok');
      } catch (e) {
        toast('양식 다운로드 실패: ' + e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
    els.tplExampleBtn.addEventListener('click', () => grabTemplate('example', els.tplExampleBtn));
    els.tplBlankBtn.addEventListener('click', () => grabTemplate('blank', els.tplBlankBtn));

    /**
     * 예시 SCADA — 업로드 없이 바로 도면을 본다.
     * 별도 데이터를 두지 않고 **양식 기입 예시본을 그대로 임포트**한다.
     * 그래서 예시 화면과 양식이 언제나 같은 내용을 가리킨다.
     */
    els.openExampleBtn.addEventListener('click', async () => {
      const btn = els.openExampleBtn;
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = '예시 여는 중…';
      try {
        const bytes = await api.template('example');
        const file = new File([bytes], '예시_SCADA.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const res = await api.import(file, { name: '예시 SCADA — 154kV 2회선 수전 공장' });
        if (!res.project) {
          toast(res.message || '예시를 만들 수 없습니다.', 'error');
          return;
        }
        await loadProjects();
        await openProject(res.project.id);
        setView('editor');
        // 값이 없으면 도면이 회색이라 예시로서 의미가 없다. 바로 채워 보여준다.
        await api.demoTick(res.project.id);
        await refreshLive();
        toast('예시 SCADA 를 열었습니다. 같은 내용이 “양식 다운로드(기입 예시)” 에 들어 있습니다.', 'ok');
      } catch (e) {
        toast('예시를 열지 못했습니다: ' + e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });

    // 구역 탭
    els.zoneBar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.zone = b.dataset.zone || '';
      applyZone();
    });

    // 알람 바 — 행 클릭 시 해당 설비 선택, 확인 버튼은 확인 처리
    els.alarmBody.addEventListener('click', (e) => {
      const ack = e.target.closest('[data-ack]');
      if (ack) {
        e.stopPropagation();
        state.acked.add(ack.dataset.ack);
        renderAlarms();
        return;
      }
      const tr = e.target.closest('tr[data-node]');
      if (tr) Canvas.select(tr.dataset.node);
    });
    els.ackAllBtn.addEventListener('click', () => {
      if (!state.alarms) return;
      for (const a of state.alarms.items) state.acked.add(a.key);
      renderAlarms();
      toast('알람을 모두 확인 처리했습니다.', 'ok');
    });

    els.saveProjectBtn.addEventListener('click', saveProject);
    els.schemaBtn.addEventListener('click', showSchema);

    els.projectSelect.addEventListener('change', async () => {
      const id = els.projectSelect.value;
      if (!id) return;
      await openProject(Number(id));
      setView('editor');
    });
    els.projectList.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        if (!window.confirm('이 도면을 삭제할까요?')) return;
        await api.deleteProject(Number(del.dataset.del));
        if (state.project && state.project.id === Number(del.dataset.del)) state.project = null;
        await loadProjects();
        toast('삭제했습니다.', 'ok');
        return;
      }
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      await openProject(Number(li.dataset.id));
      setView('editor');
    });

    els.mainStrip.addEventListener('click', (e) => {
      const card = e.target.closest('[data-id]');
      if (card) { Canvas.select(card.dataset.id); renderMainStrip(); }
    });

    els.addMainBtn.addEventListener('click', addMain);
    els.addLoadBtn.addEventListener('click', addLoad);
    els.deleteNodeBtn.addEventListener('click', deleteSelected);
    els.zoomInBtn.addEventListener('click', () => Canvas.zoomBy(1.2));
    els.zoomOutBtn.addEventListener('click', () => Canvas.zoomBy(1 / 1.2));
    els.fitBtn.addEventListener('click', () => Canvas.fit());
    els.relayoutBtn.addEventListener('click', () => Canvas.autoLayout());
    els.saveBtn.addEventListener('click', saveDiagram);
    els.liveChk.addEventListener('change', () => setLivePolling(els.liveChk.checked));

    els.demoBtn.addEventListener('click', async () => {
      if (!state.project) return;
      if (!state.project.publishedAt) await api.publish(state.project.id);
      const r = await api.demoTick(state.project.id);
      await refreshLive();
      toast(`데모 값 ${r.injected}건을 주입했습니다.`, 'ok');
    });

    els.exportPdfBtn.addEventListener('click', async () => {
      if (!state.project) return;
      const btn = els.exportPdfBtn;
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'PDF 생성 중…';
      try {
        const site = state.project.model.site;
        const mains = state.project.diagram.nodes.filter((n) => n.kind === 'main');
        const bytes = await window.ScadaPdf.fromSvg(Canvas.toSvgString(), {
          title: state.project.name,
          subtitle: [site.company, site.address].filter(Boolean).join(' · '),
          meta: [
            ['수전점', mains.length + '회선'],
            ['계약전력', site.contractPower != null ? fmt(site.contractPower) + ' kW' : null],
            ['수전용량', site.receivingCapacity != null ? fmt(site.receivingCapacity) + ' kW' : null],
            ['작성일', new Date().toLocaleDateString('ko-KR')],
          ],
          paper: 'A3',
        });
        await download(state.project.name + '.pdf', bytes, 'application/pdf');
        toast('PDF 를 내보냈습니다. (A3 가로)', 'ok');
      } catch (e) {
        toast('PDF 생성 실패: ' + e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });

    els.exportSvgBtn.addEventListener('click', () => {
      if (!state.project) return;
      download(`${state.project.name}.svg`, Canvas.toSvgString(), 'image/svg+xml');
    });
    els.exportJsonBtn.addEventListener('click', () => {
      if (!state.project) return;
      download(`${state.project.name}.json`, JSON.stringify(state.project.diagram, null, 2), 'application/json');
    });

    els.publishBtn.addEventListener('click', async () => {
      if (!state.project) return;
      if (state.dirty) await saveDiagram();
      const r = await api.publish(state.project.id);
      toast(`계측 포인트 ${r.count}건을 FEMS(사업장 ${r.site})에 등록했습니다.`, 'ok');
      state.project.publishedAt = new Date().toISOString();
      await loadProjects();
    });

    window.addEventListener('beforeunload', (e) => {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  // ── 시작 ───────────────────────────────────────────────────────
  async function boot() {
    Canvas.init({
      host: els.canvas,
      svg: els.sld,
      onChange: markDirty,
      onSelect: (node) => { renderInspector(node); renderMainStrip(); },
    });
    wire();
    tick();
    setInterval(tick, 1000);
    try {
      await loadProjects();
    } catch (e) {
      status(`❌ <div>서버에 연결할 수 없습니다. <code>npm start</code> 로 서버가 실행 중인지 확인하세요.</div>`, 'error');
    }
  }

  boot();
})();
