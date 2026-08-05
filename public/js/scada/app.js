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
    'measureBtn', 'measureMenu', 'measureBody', 'measureCount', 'measureResetBtn', 'measureCloseBtn',
    'palette', 'paletteTabs', 'paletteItems', 'paletteHint', 'paletteToggle', 'tieBtn', 'frameChk',
    'nbCompany', 'nbCode', 'nbVoltage', 'nbContract', 'newBlankBtn',
    'importDrawingBtn', 'drawingInput', 'importResult', 'importHint',
    'underlayBar', 'ulOpacity', 'ulSmaller', 'ulBigger', 'ulRemove', 'penChk',
    'glSearch', 'glTabs', 'glBody',
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
    palette: '전원',        // 심볼 메뉴바에서 열려 있는 분류
    glTab: '심볼',          // 기호 해설에서 열려 있는 분류
    imported: null,        // 가져온 전기도면 (밑그림 + 인식 결과)
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
    for (const name of ['upload', 'editor', 'dashboard', 'points', 'glossary']) $(`view-${name}`).hidden = name !== view;
    if (view === 'editor') setTimeout(() => Canvas.fit(), 30);
    if (view === 'dashboard') renderDashboard();
    if (view === 'points') renderPoints();
    if (view === 'glossary') renderGlossary();
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
    renderMeasureMenu();
    renderPalette();
    renderMainStrip();
    renderLegend();
    renderInspector(null);
    await refreshLive();
  }

  function markDirty() {
    state.dirty = true;
    els.saveBtn.textContent = '저장 *';
    renderAlarms();
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

    // 계측이 하나도 붙지 않은 도면(엑셀 없이 그린 새 도면)에서는
    // '--' 만 늘어놓은 큰 카드가 화면만 잡아먹는다. 요약 카드로 줄인다.
    const metered = mains.some((m) => m.display && Object.keys(m.display).length);
    if (!metered) {
      els.mainStrip.innerHTML = mains
        .map(
          (m) => `<article class="sc-maincard is-bare${m.id === Canvas.selectedId ? ' is-selected' : ''}" data-id="${esc(m.id)}">
              <div class="sc-maincard-head">
                <span class="sc-maincard-name">${esc(m.name)}</span>
                <span class="sc-maincard-tag">${m.rating ? esc(m.rating) : '계측 미연결'}</span>
              </div>
              <div class="sc-bare-note">
                ${m.ratedPower != null ? `계약전력 <b>${fmt(m.ratedPower)} kW</b> · ` : ''}하위 설비 ${state.project.diagram.nodes.filter((n) => n.mainId === m.id).length - 1}개
                <span class="sc-muted">— 계측값은 엑셀을 올리거나 FEMS 포인트를 연결하면 표시됩니다.</span>
              </div>
            </article>`
        )
        .join('');
      return;
    }

    els.mainStrip.innerHTML = mains
      .map((m) => {
        // KPI 스트립도 도면과 같은 "표시 항목" 을 따른다.
        // 다만 수전점은 순시 전력이 관제의 핵심이라 유효전력을 항상 앞에 세운다.
        const items = Canvas.displayItems();
        const withPower = items.some((it) => it.id === 'power')
          ? items
          : [Canvas.measure('power')].filter(Boolean).concat(items);
        const rows = withPower
          .map((item) => {
            const d = m.display && m.display[item.id];
            const r = d ? Canvas.reading(d.key) : null;
            const stale = !r || r.stale;
            const unit = (d && d.unit) || item.unit;
            const shown = stale ? { value: null, unit } : Canvas.scaleValue(r.value, unit);
            return `<div class="sc-mrow${stale ? ' is-stale' : ''}">
                <span class="k">${esc(item.label)}</span>
                <span class="v">${stale ? '--' : fmt(shown.value)}</span>
                <span class="u">${esc(shown.unit)}</span>
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
            <div class="sc-maincard-rows${withPower.length > 6 ? ' is-dense' : ''}">${rows}</div>
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

  // ── 전기도면 가져오기 ──────────────────────────────────────────
  /**
   * 그림·PDF 로 된 전기도면을 SCADA 도면으로 옮긴다.
   *
   * 벡터 PDF 는 글자를 읽어 기기까지 자동 인식하고, 스캔·사진은 밑그림으로
   * 깔아 따라 그리게 한다. 어느 쪽이든 **결과물은 같은 도면 문서**다.
   */
  async function importDrawing(file) {
    if (!file) return;
    const btn = els.importDrawingBtn;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '읽는 중…';
    els.importResult.hidden = false;
    els.importResult.innerHTML = `<p class="sc-muted">${esc(file.name)} 분석 중…</p>`;
    try {
      const res = await window.ScadaDrawingImport.read(file);
      state.imported = res;
      renderImportResult(res);
    } catch (e) {
      els.importResult.innerHTML = `<p class="sc-imp-bad">도면을 읽지 못했습니다 — ${esc(e.message)}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function renderImportResult(res) {
    const items = res.items || [];
    const hasUnderlay = !!(res.underlay && res.underlay.dataUrl);

    const rows = items.length
      ? items
          .map(
            (it, i) => `<label class="sc-imp-row">
              <input type="checkbox" data-imp="${i}" ${it.use ? 'checked' : ''} />
              <svg class="sc-imp-sym" viewBox="0 0 26 22" aria-hidden="true">${Sym.draw(it.symbol, 13, 11, 8)}</svg>
              <span class="sc-imp-name">${esc(it.name)}</span>
              <span class="sc-imp-label">${esc(it.label)}</span>
            </label>`
          )
          .join('')
      : '';

    els.importResult.innerHTML = `
      <div class="sc-imp-head">
        <strong>${esc(res.filename)}</strong>
        <span class="sc-muted">${res.kind === 'pdf' ? 'PDF' : '이미지'} · 글자 ${(res.tokens || []).length}개 · 인식 ${items.length}개${hasUnderlay ? ' · 밑그림 있음' : ''}</span>
      </div>
      ${items.length
        ? `<p class="sc-muted">아래 기기로 계통을 만들 수 있습니다. 잘못 잡힌 항목은 체크를 해제하세요.</p>
           <div class="sc-imp-list">${rows}</div>`
        : `<p class="sc-imp-note">
             글자를 꺼낼 수 없는 <b>스캔·사진 도면</b>입니다 (도면 전체가 하나의 그림).
             ${hasUnderlay
               ? '이 도면을 <b>밑그림</b>으로 깔아 드립니다. 심볼 메뉴바에서 기호를 고른 뒤 도면 위를 클릭하면 그 자리에 놓입니다.'
               : '밑그림으로 쓸 이미지를 찾지 못했습니다. 도면을 PNG·JPG 로 저장해 다시 올려 주세요.'}
           </p>`}
      <div class="sc-imp-actions">
        <button class="sc-btn sc-btn-primary" id="impBuildBtn"${!items.length && !hasUnderlay ? ' disabled' : ''}>
          ${items.length ? '이 내용으로 도면 만들기' : '밑그림 깔고 그리기 시작'}
        </button>
        <button class="sc-btn sc-btn-ghost" id="impCancelBtn">취소</button>
      </div>`;

    els.importResult.querySelectorAll('[data-imp]').forEach((cb) => {
      cb.addEventListener('change', () => { items[Number(cb.dataset.imp)].use = cb.checked; });
    });
    const build = $('impBuildBtn');
    if (build) build.addEventListener('click', () => buildFromDrawing(res));
    const cancel = $('impCancelBtn');
    if (cancel) cancel.addEventListener('click', () => { els.importResult.hidden = true; state.imported = null; });
  }

  /** 인식 결과 + 밑그림 → 새 도면 */
  async function buildFromDrawing(res) {
    const btn = $('impBuildBtn');
    if (btn) { btn.disabled = true; btn.textContent = '만드는 중…'; }
    try {
      const base = String(res.filename || '전기도면').replace(/\.[^.]+$/, '');
      const created = await api.createBlank({
        company: (els.nbCompany.value || '').trim() || base,
        factoryCode: (els.nbCode.value || '').trim() || 'SITE',
        voltage: els.nbVoltage.value === '' ? null : Number(els.nbVoltage.value),
        contractPower: els.nbContract.value === '' ? null : Number(els.nbContract.value),
        name: `${base} 단선결선도`,
      });
      await loadProjects();
      await openProject(created.project.id);
      setView('editor');

      const d = state.project.diagram;
      const tree = window.ScadaDrawingImport.buildTree(res.items || []);
      if (tree.length) {
        // 자동 인식 결과로 계통을 세운다 (빈 도면의 기본 수전점은 첫 노드로 대체)
        d.nodes = [];
        d.edges = [];
        const idByKey = {};
        let seq = 0;
        for (const t of tree) {
          const parentId = t.parent ? idByKey[t.parent] : null;
          const node = Canvas.addNode(t.symbol, parentId, { name: t.name });
          if (!node) continue;
          idByKey[t.key] = node.id;
          seq++;
          if (t.spec) {
            if (t.spec.voltage != null) node.voltage = t.spec.voltage;
            if (t.spec.trip != null) node.ratedCurrent = t.spec.trip;
            if (t.spec.breakingCapacity != null) node.breakingCapacity = t.spec.breakingCapacity;
            if (t.spec.ratedPower != null) node.ratedPower = t.spec.ratedPower;
            if (t.spec.capacityKva != null && t.symbol === 'transformer') {
              node.transformer = { capacity: t.spec.capacityKva, label: transformerLabel({ capacity: t.spec.capacityKva }) };
            }
            if (t.spec.tag) node.tag = t.spec.tag;
            Canvas.refreshRating(node);
          }
        }
        Canvas.autoLayout();
        toast(`도면에서 기기 ${seq}개를 인식해 계통을 만들었습니다. 속성 패널에서 다듬으세요.`, 'ok');
      }

      if (res.underlay && res.underlay.dataUrl) {
        Canvas.setUnderlay({ ...res.underlay, name: res.filename });
        els.penChk.checked = true; // 밑그림을 깔면 바로 따라 그릴 수 있게
        if (!tree.length) {
          toast('밑그림을 깔았습니다. 심볼 메뉴바에서 기호를 고른 뒤 도면 위를 클릭하세요.', 'ok');
        }
      }
      syncUnderlayBar();
      renderMainStrip();
      renderPalette();
      markDirty();
    } catch (e) {
      toast('도면을 만들지 못했습니다: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '다시 시도'; }
    }
  }

  /** 밑그림 도구막대 표시/동기화 */
  function syncUnderlayBar() {
    const u = Canvas.underlay;
    els.underlayBar.hidden = !u;
    if (u) els.ulOpacity.value = String(Math.round((u.opacity == null ? 0.45 : u.opacity) * 100));
  }

  // ── 심볼 메뉴바 (팔레트) ───────────────────────────────────────
  /**
   * 단선결선도 기호 메뉴바.
   *
   * 엑셀 없이도 도면을 그릴 수 있어야 하므로, 계통에 놓을 수 있는 기호를
   * 전부 분류별로 꺼내 둔다. 기호를 누르면 **선택한 설비 아래**로 붙고,
   * 아무것도 선택하지 않았으면 새 수전 계통(루트)으로 들어간다.
   */
  function renderPalette() {
    const groups = Sym.GROUPS;
    if (!groups.some((g) => g.name === state.palette)) state.palette = groups[0].name;

    els.paletteTabs.innerHTML = groups
      .map((g) => `<button data-pg="${esc(g.name)}" class="${g.name === state.palette ? 'active' : ''}">${esc(g.name)} <b>${g.items.length}</b></button>`)
      .join('');

    const items = (groups.filter((g) => g.name === state.palette)[0] || { items: [] }).items;
    const pen = Canvas.pen;
    els.paletteItems.innerHTML = items
      .map((it) => {
        const g = window.ScadaGlossary.bySymbol(it.id);
        const tip = [it.label, g && g.en, g && g.what].filter(Boolean).join(' — ');
        return `<button class="sc-sym${pen === it.id ? ' is-pen' : ''}" data-sym="${esc(it.id)}" title="${esc(tip)}">
            <svg viewBox="0 0 30 26" aria-hidden="true">${Sym.draw(it.id, 15, 13, 9)}</svg>
            <span class="sc-sym-name">${esc(it.label)}</span>
            <i class="sc-sym-help" data-help="${esc(it.id)}" title="이 기호 설명 보기">?</i>
          </button>`;
      })
      .join('');

    const sel = state.project && state.project.diagram.nodes.filter((n) => n.id === Canvas.selectedId)[0];
    const penSpec = pen && Sym.byId(pen);
    els.paletteHint.innerHTML = Canvas.tieFrom
      ? '연락(TIE) 연결 중 — <b>상대편 설비를 클릭</b>하세요. (Esc 취소)'
      : penSpec
        ? `<b>${esc(penSpec.label)}</b> 를 들고 있습니다 — <b>도면 위를 클릭</b>하면 그 자리에 놓입니다. 연달아 찍을 수 있고, Esc 로 내려놓습니다.`
        : els.penChk.checked
          ? '<b>따라 그리기</b> 켜짐 — 기호를 고른 뒤 도면 위를 클릭하면 그 자리에 놓입니다.'
          : sel
            ? `기호를 누르면 <b>${esc(sel.name)}</b> 아래에 붙습니다. 밑그림을 따라 그리려면 도구막대의 <b>따라 그리기</b>를 켜세요.`
            : '설비를 먼저 선택하면 그 아래에 붙고, 선택이 없으면 <b>새 수전 계통</b>으로 추가됩니다.';
  }

  /** 엑셀 없이 새 도면 시작 */
  async function createBlank() {
    const btn = els.newBlankBtn;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '만드는 중…';
    try {
      const company = (els.nbCompany.value || '').trim() || '새 사업장';
      const res = await api.createBlank({
        company,
        factoryCode: (els.nbCode.value || '').trim() || 'SITE',
        voltage: els.nbVoltage.value === '' ? null : Number(els.nbVoltage.value),
        contractPower: els.nbContract.value === '' ? null : Number(els.nbContract.value),
        name: `${company} 단선결선도`,
      });
      if (!res.project) return toast('도면을 만들지 못했습니다.', 'error');
      await loadProjects();
      await openProject(res.project.id);
      setView('editor');
      toast('빈 도면을 만들었습니다. 아래 심볼 메뉴바에서 기호를 골라 계통을 그리세요.', 'ok');
    } catch (e) {
      toast('새 도면 실패: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  // ── 기호 해설 ──────────────────────────────────────────────────
  /**
   * 전기도면을 처음 보는 사람이 기호와 숫자를 읽을 수 있게 하는 화면.
   * 「전기도면 해설」의 항목별 설명을 심볼 단위로 정리해 두었다.
   */
  const GL_TABS = ['심볼', '기기번호(ANSI)', '표기 읽는 법', '에너지원'];

  function renderGlossary() {
    const G = window.ScadaGlossary;
    const q = (els.glSearch.value || '').trim();
    const found = q ? G.search(q) : null;

    els.glTabs.innerHTML = GL_TABS.map(
      (t) => `<button data-gl="${esc(t)}" class="${t === state.glTab ? 'active' : ''}">${esc(t)}</button>`
    ).join('');

    if (found) {
      const total = found.symbols.length + found.ansi.length + found.notation.length + found.energy.length;
      els.glBody.innerHTML = total
        ? (found.symbols.length ? `<h3 class="sc-gl-h">심볼 ${found.symbols.length}</h3>` + found.symbols.map(symbolCard).join('') : '') +
          (found.ansi.length ? `<h3 class="sc-gl-h">기기번호 ${found.ansi.length}</h3>` + ansiTable(found.ansi) : '') +
          (found.notation.length ? `<h3 class="sc-gl-h">표기 ${found.notation.length}</h3>` + notationList(found.notation) : '') +
          (found.energy.length ? `<h3 class="sc-gl-h">에너지원 ${found.energy.length}</h3>` + found.energy.map(energyCard).join('') : '')
        : `<p class="sc-empty">‘${esc(q)}’ 에 해당하는 항목이 없습니다.</p>`;
      return;
    }

    if (state.glTab === '심볼') {
      els.glBody.innerHTML = Sym.GROUPS.map(
        (g) => `<h3 class="sc-gl-h">${esc(g.name)}</h3>` +
          g.items.map((it) => symbolCard(it.id)).join('')
      ).join('');
    } else if (state.glTab === '기기번호(ANSI)') {
      els.glBody.innerHTML =
        '<p class="sc-muted sc-gl-lead">단선결선도의 원 안 숫자는 ANSI/IEEE C37.2 기기번호다. 보호계전기가 무엇을 보는지 알려 준다.</p>' +
        ansiTable(window.ScadaGlossary.ANSI);
    } else if (state.glTab === '표기 읽는 법') {
      els.glBody.innerHTML =
        '<p class="sc-muted sc-gl-lead">도면의 숫자·약어를 읽는 법. AF/AT 를 헷갈리면 차단기를 잘못 고른다.</p>' +
        notationList(window.ScadaGlossary.NOTATION);
    } else {
      els.glBody.innerHTML =
        '<p class="sc-muted sc-gl-lead">FEMS 가 집계하는 에너지원과 단위. 전력만 보면 공장 에너지의 절반을 놓친다.</p>' +
        window.ScadaGlossary.ENERGY.map(energyCard).join('');
    }
  }

  function symbolCard(id) {
    const g = window.ScadaGlossary.bySymbol(id);
    const spec = Sym.byId(id);
    if (!g) {
      return `<article class="sc-gl-card">
          <div class="sc-gl-sym"><svg viewBox="0 0 40 34">${Sym.draw(id, 20, 17, 12)}</svg></div>
          <div class="sc-gl-txt"><h4>${esc((spec && spec.label) || id)}</h4><p class="sc-muted">해설 준비 중</p></div>
        </article>`;
    }
    const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
    return `<article class="sc-gl-card">
        <div class="sc-gl-sym"><svg viewBox="0 0 40 34">${Sym.draw(id, 20, 17, 12)}</svg></div>
        <div class="sc-gl-txt">
          <h4>${esc(g.name)} <span class="sc-gl-en">${esc(g.en || '')}</span>
            ${(g.ansi || []).map((a) => `<i class="sc-gl-ansi">${esc(a)}</i>`).join('')}</h4>
          <p class="sc-gl-what">${md(g.what)}</p>
          ${g.read ? `<p class="sc-gl-read"><span>도면 읽기</span>${md(g.read)}</p>` : ''}
          ${g.note ? `<p class="sc-gl-note"><span>실무</span>${md(g.note)}</p>` : ''}
        </div>
      </article>`;
  }

  function ansiTable(list) {
    return `<table class="sc-table sc-gl-table">
        <thead><tr><th style="width:110px">기기번호</th><th style="width:200px">명칭</th><th>하는 일</th></tr></thead>
        <tbody>${list.map((a) => `<tr><td><code>${esc(a.code)}</code></td><td>${esc(a.name)}</td><td>${esc(a.desc)}</td></tr>`).join('')}</tbody>
      </table>`;
  }

  function notationList(list) {
    const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
    return `<dl class="sc-gl-notation">${list
      .map((n) => `<div><dt>${esc(n.term)}</dt><dd>${md(n.what)}</dd></div>`)
      .join('')}</dl>`;
  }

  function energyCard(e) {
    return `<article class="sc-gl-card is-energy">
        <div class="sc-gl-unit">${esc(e.unit)}</div>
        <div class="sc-gl-txt">
          <h4>${esc(e.name)}</h4>
          <p class="sc-gl-what">${esc(e.what)}</p>
          <p class="sc-gl-note"><span>실무</span>${esc(e.note)}</p>
        </div>
      </article>`;
  }

  // ── 표시 항목 메뉴 ─────────────────────────────────────────────
  /**
   * 각 포인트(설비 박스)에 무엇을 띄울지 고른다.
   * 기본은 유효전력량·전류·전압·역률 4종이고, 전력품질·설비운전·타에너지·환경
   * 계측 항목을 필요한 만큼 켜서 붙인다. 항목 수가 늘면 박스가 그만큼 높아진다.
   */
  function renderMeasureMenu() {
    const d = state.project && state.project.diagram;
    if (!d) return;
    const on = new Set(Canvas.displayItems().map((m) => m.id));
    els.measureCount.textContent = String(on.size);

    // 항목별로 "값을 실제로 가진 설비 수" 를 함께 보여 준다 —
    // 켜 봐야 빈칸만 나오는 항목을 미리 알 수 있다.
    const have = {};
    for (const n of d.nodes) for (const id of Object.keys(n.display || {})) have[id] = (have[id] || 0) + 1;

    const groups = [];
    for (const m of Canvas.catalog()) {
      let g = groups.filter((x) => x.name === m.group)[0];
      if (!g) groups.push((g = { name: m.group, items: [] }));
      g.items.push(m);
    }

    els.measureBody.innerHTML = groups
      .map(
        (g) => `<div class="sc-measure-group">
            <h4>${esc(g.name)}</h4>
            <div class="sc-measure-list">
              ${g.items
                .map((m) => {
                  const n = have[m.id] || 0;
                  return `<label class="sc-measure-item${n ? '' : ' is-empty'}" title="${esc(m.label)} (${esc(m.unit || '-')})">
                      <input type="checkbox" data-measure="${esc(m.id)}"${on.has(m.id) ? ' checked' : ''} />
                      <span>${esc(m.label)}</span>
                      <span class="mi-unit">${esc(m.unit || '')}</span>
                      <span class="mi-have">${n ? n + '개' : '값 없음'}</span>
                    </label>`;
                })
                .join('')}
            </div>
          </div>`
      )
      .join('');
  }

  /** 체크 상태 → 도면에 반영 (박스 높이·레인 간격까지 다시 잡힌다) */
  function applyMeasureMenu() {
    const ids = [...els.measureBody.querySelectorAll('input[data-measure]:checked')].map((i) => i.dataset.measure);
    Canvas.setDisplayItems(ids);
    renderMeasureMenu();
    renderMainStrip();
    markDirty();
  }

  function toggleMeasureMenu(show) {
    const open = show == null ? els.measureMenu.hidden : show;
    els.measureMenu.hidden = !open;
    els.measureBtn.setAttribute('aria-expanded', String(open));
    if (open) renderMeasureMenu();
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
      <span><i style="background:var(--wire-live)"></i>가압 (계측 정상)</span>
      <span><i style="background:#2b7f68"></i>가압 (계측 없음)</span>
      <span><i style="background:var(--wire-dead)"></i>정전 — 차단기 개방</span>
      <span><i style="background:var(--wire-alarm)"></i>정격 초과</span>
      <span><b>차단기 클릭 = 투입/개방</b> (채움=투입 / 빔=개방)</span>
      <span>드래그: 설비 이동 · 휠: 확대 · 빈 곳 드래그: 화면 이동</span>`;
  }

  // ── 속성 패널 ──────────────────────────────────────────────────
  /**
   * 설비 속성 편집.
   *
   * 엑셀로 들어오는 값(기기종류·전압·정격·보호요소·구역·TAG·변압기 제원)을
   * **화면에서도 전부 입력**할 수 있어야 엑셀 없이 도면이 완성된다.
   * 그래서 엑셀 열과 1:1 로 대응하는 항목을 모두 열어 두었다.
   */
  function renderInspector(node) {
    els.deleteNodeBtn.disabled = !node;
    if (!node) {
      els.inspectorBody.innerHTML = '<p class="sc-empty">도면에서 설비를 선택하면 속성이 표시됩니다.<br>비어 있는 도면이라면 아래 심볼 메뉴바에서 기호를 골라 넣으세요.</p>';
      return;
    }

    const d = state.project.diagram;
    const tables = d.codeTables || {};
    const kindLabel = { main: '수전 계통 (루트)', group: '계통 (분기)', load: '말단 설비' }[node.kind] || node.kind;

    const symbolOptions = Sym.GROUPS.map(
      (g) => `<optgroup label="${esc(g.name)}">` +
        g.items.map((it) => `<option value="${it.id}"${it.id === node.symbol ? ' selected' : ''}>${esc(it.label)}</option>`).join('') +
        '</optgroup>'
    ).join('');

    const kindOptions = '<option value="">— 미지정 —</option>' +
      (tables.deviceKinds || []).map(
        (k) => `<option value="${esc(k.code)}"${k.code === node.deviceKind ? ' selected' : ''}>${esc(k.code)} · ${esc(k.name)}</option>`
      ).join('');

    const parentOptions = '<option value="">— 없음 (수전 계통) —</option>' +
      d.nodes
        .filter((n) => n.id !== node.id)
        .map((n) => `<option value="${esc(n.id)}"${n.id === node.parent ? ' selected' : ''}>${esc(n.name)}</option>`)
        .join('');

    const zoneOptions = '<option value="">— 미지정 —</option>' +
      (d.zones || []).map((z) => `<option value="${esc(z.code)}"${z.code === node.zoneCode ? ' selected' : ''}>${esc(z.name)}</option>`).join('');

    const protOn = new Set(node.protection || []);
    const protChips = (tables.protection || [])
      .map(
        (pc) => `<label class="sc-chip${protOn.has(pc.code) ? ' is-on' : ''}" title="${esc(pc.name)}">
            <input type="checkbox" data-prot="${esc(pc.code)}"${protOn.has(pc.code) ? ' checked' : ''} />${esc(pc.code)}
          </label>`
      )
      .join('');

    const tr = node.transformer || {};
    const trBlock = node.deviceKind === 'TR' || node.deviceKind === 'TR3' || node.symbol === 'transformer'
      ? `<div class="sc-subhead">변압기 제원</div>
         <div class="sc-field2">
           <label>1차 (kV)<input id="fTrP" type="number" step="0.01" value="${tr.primaryVoltage != null ? tr.primaryVoltage : ''}" /></label>
           <label>2차 (kV)<input id="fTrS" type="number" step="0.01" value="${tr.secondaryVoltage != null ? tr.secondaryVoltage : ''}" /></label>
         </div>
         <div class="sc-field2">
           <label>용량 (kVA)<input id="fTrC" type="number" step="1" value="${tr.capacity != null ? tr.capacity : ''}" /></label>
           <label>%Z<input id="fTrZ" type="number" step="0.1" value="${tr.impedance != null ? tr.impedance : ''}" /></label>
         </div>
         <div class="sc-field2">
           <label>결선<select id="fTrV"><option value="">—</option>${(tables.vectorGroups || []).map((v) => `<option${v === tr.vectorGroup ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
           <label>냉각<select id="fTrK"><option value="">—</option>${(tables.coolingTypes || []).map((v) => `<option${v === tr.cooling ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
         </div>`
      : '';

    // 지금 도면 박스에 올라가 있는 포인트에는 표시를 해 둔다
    const shownKeys = new Set(
      Canvas.displayItems()
        .map((it) => node.display && node.display[it.id] && node.display[it.id].key)
        .filter(Boolean)
    );
    const pointRows = (node.points || [])
      .map((p) => {
        const r = Canvas.reading(p.key);
        const stale = !r || r.stale;
        return `<li${shownKeys.has(p.key) ? ' class="is-shown"' : ''}>
            <span class="pn">${esc(p.name)}${shownKeys.has(p.key) ? '<i class="pn-on" title="도면에 표시 중">도면</i>' : ''}</span>
            <span class="pv${stale ? ' is-stale' : ''}">${stale ? '--' : fmt(r.value)} ${esc(p.unit || '')}</span>
          </li>`;
      })
      .join('');

    const ties = (d.ties || []).filter((t) => t.from === node.id || t.to === node.id);
    const tieRows = ties
      .map((t) => {
        const other = d.nodes.filter((n) => n.id === (t.from === node.id ? t.to : t.from))[0];
        return `<li>
            <span class="pn">${esc(t.tag || 'TIE')} → ${esc(other ? other.name : '?')}</span>
            <span class="tie-ops">
              <button class="sc-mini" data-tie-toggle="${esc(t.id)}">${t.state === 'open' ? '투입' : '개방'}</button>
              <button class="sc-mini is-danger" data-tie-del="${esc(t.id)}">삭제</button>
            </span>
          </li>`;
      })
      .join('');

    els.inspectorBody.innerHTML = `
      <div class="sc-subhead">${esc(kindLabel)}</div>
      <div class="sc-field"><label for="fName">설비명</label><input id="fName" value="${esc(node.name)}" /></div>
      <div class="sc-field2">
        <label>기기 TAG<input id="fTag" value="${esc(node.tag || '')}" placeholder="VCB-201" /></label>
        <label>구역<select id="fZone">${zoneOptions}</select></label>
      </div>
      <div class="sc-field"><label for="fKind">기기종류</label><select id="fKind">${kindOptions}</select></div>
      <div class="sc-field"><label for="fSymbol">심볼 <button class="sc-mini" id="fSymHelp" title="이 기호 설명 보기">설명</button></label><select id="fSymbol">${symbolOptions}</select></div>
      <div class="sc-field"><label for="fParent">상위 계통</label><select id="fParent">${parentOptions}</select></div>

      <div class="sc-subhead">정격</div>
      <div class="sc-field2">
        <label>전압 (kV)<input id="fVolt" type="number" step="0.01" value="${node.voltage != null ? node.voltage : ''}" placeholder="22.9" /></label>
        <label>정격전류 (A)<input id="fAmp" type="number" step="1" value="${node.ratedCurrent != null ? node.ratedCurrent : ''}" /></label>
      </div>
      <div class="sc-field2">
        <label>차단용량 (kA)<input id="fKa" type="number" step="0.1" value="${node.breakingCapacity != null ? node.breakingCapacity : ''}" /></label>
        <label>${node.kind === 'main' ? '계약전력' : '정격용량'} (kW)<input id="fRated" type="number" step="0.1" value="${node.ratedPower != null ? node.ratedPower : ''}" /></label>
      </div>
      ${node.kind === 'main'
        ? `<div class="sc-field"><label for="fCapacity">수전용량 (kW)</label>
             <input id="fCapacity" type="number" step="0.1" value="${node.capacity != null ? node.capacity : ''}" placeholder="미설정" /></div>`
        : ''}

      <div class="sc-subhead">운전 · 접지</div>
      <div class="sc-field-row">
        <label class="sc-check"><input type="checkbox" id="fBreaker"${node.breakerState !== 'open' ? ' checked' : ''} /> 차단기 투입</label>
        <label class="sc-check"><input type="checkbox" id="fGround"${node.grounded ? ' checked' : ''} /> 중성점 접지</label>
      </div>

      <div class="sc-subhead">보호요소 (ANSI)</div>
      <div class="sc-chips" id="protChips">${protChips}</div>

      ${trBlock}

      <div class="sc-subhead">모선 연락 (TIE)</div>
      ${tieRows ? `<ul class="sc-pointlist">${tieRows}</ul>` : '<p class="sc-empty">연락 결선이 없습니다. 도구막대의 “연락(TIE) 연결” 로 만드세요.</p>'}

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

    // ── 입력 바인딩 ──────────────────────────────────────────────
    const num = (v) => (v === '' ? null : Number(v));
    const after = () => { Canvas.render(); renderMainStrip(); renderAlarms(); markDirty(); };
    const bind = (id, apply, redrawInspector) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', () => {
        apply(el.type === 'checkbox' ? el.checked : el.value);
        after();
        if (redrawInspector) renderInspector(node);
      });
    };

    bind('fName', (v) => { node.name = String(v).trim() || node.name; });
    bind('fTag', (v) => { node.tag = String(v).trim() || null; });
    bind('fZone', (v) => {
      node.zoneCode = v || null;
      const z = (d.zones || []).filter((x) => x.code === v)[0];
      node.zoneName = z ? z.name : null;
      renderZoneBar();
    });
    bind('fKind', (v) => {
      node.deviceKind = v || null;
      // 기기종류를 고르면 심볼도 그 종류의 표준 기호로 맞춘다
      const k = (tables.deviceKinds || []).filter((x) => x.code === v)[0];
      if (k && k.symbol) node.symbol = k.symbol;
    }, true);
    bind('fSymbol', (v) => { node.symbol = v; });
    const symHelp = $('fSymHelp');
    if (symHelp) {
      symHelp.addEventListener('click', () => {
        state.glTab = '심볼';
        els.glSearch.value = (Sym.byId(node.symbol) || {}).label || node.symbol;
        setView('glossary');
      });
    }
    bind('fParent', (v) => {
      if (!Canvas.setParent(node.id, v || null)) toast('자기 하위 계통을 상위로 지정할 수 없습니다.', 'error');
    }, true);
    bind('fVolt', (v) => { node.voltage = num(v); Canvas.refreshRating(node); });
    bind('fAmp', (v) => { node.ratedCurrent = num(v); Canvas.refreshRating(node); });
    bind('fKa', (v) => { node.breakingCapacity = num(v); Canvas.refreshRating(node); });
    bind('fRated', (v) => { node.ratedPower = num(v); });
    bind('fCapacity', (v) => { node.capacity = num(v); });
    bind('fBreaker', (on) => { node.breakerState = on ? 'closed' : 'open'; });
    bind('fGround', (on) => { node.grounded = !!on; });

    // 변압기 제원
    const trBind = (id, key, isNum) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', () => {
        node.transformer = node.transformer || { systemId: node.systemId };
        node.transformer[key] = isNum ? num(el.value) : el.value || null;
        node.transformer.label = transformerLabel(node.transformer);
        after();
      });
    };
    trBind('fTrP', 'primaryVoltage', true);
    trBind('fTrS', 'secondaryVoltage', true);
    trBind('fTrC', 'capacity', true);
    trBind('fTrZ', 'impedance', true);
    trBind('fTrV', 'vectorGroup', false);
    trBind('fTrK', 'cooling', false);

    const chips = $('protChips');
    if (chips) {
      chips.addEventListener('change', (e) => {
        const cb = e.target.closest('[data-prot]');
        if (!cb) return;
        const set = new Set(node.protection || []);
        if (cb.checked) set.add(cb.dataset.prot); else set.delete(cb.dataset.prot);
        // 코드표 순서를 유지해야 도면 표기가 흔들리지 않는다
        node.protection = (tables.protection || []).map((p) => p.code).filter((c) => set.has(c));
        cb.closest('.sc-chip').classList.toggle('is-on', cb.checked);
        after();
      });
    }

  }

  /** 변압기 제원 두 줄 — 서버 diagram.transformerLabel() 과 같은 규칙 */
  function transformerLabel(tr) {
    const kva = tr.capacity;
    const cap = kva == null ? null : kva >= 1000 ? `${+(kva / 1000).toFixed(kva % 1000 ? 1 : 0)}MVA` : `${kva}kVA`;
    const line1 = [
      tr.primaryVoltage != null && tr.secondaryVoltage != null ? `${tr.primaryVoltage}/${tr.secondaryVoltage}kV` : null,
      cap,
    ].filter(Boolean).join(' ');
    const line2 = [tr.vectorGroup, tr.impedance != null ? `%Z${tr.impedance}` : null, tr.cooling]
      .filter(Boolean).join(' ');
    return { line1, line2 };
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

  /** 선택 계통 아래에 일반 부하 추가 (심볼 메뉴바의 '일반 부하' 와 같은 동작) */
  function addLoad() {
    if (!state.project) return toast('먼저 도면을 여세요.', 'error');
    const d = state.project.diagram;
    const parent = d.nodes.filter((n) => n.id === Canvas.selectedId)[0] || d.nodes.filter((n) => n.kind === 'main')[0];
    if (!parent) return toast('상위 계통이 없습니다. 먼저 수전점을 추가하세요.', 'error');
    Canvas.addNode('load', parent.id);
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
      if (btn.dataset.view !== 'upload' && !btn.dataset.free && !state.project) {
        return toast('먼저 도면을 만들거나 저장된 도면을 여세요.', 'error');
      }
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

    // 엑셀 없이 새 도면
    els.newBlankBtn.addEventListener('click', createBlank);
    for (const id of ['nbCompany', 'nbCode', 'nbVoltage', 'nbContract']) {
      els[id].addEventListener('keydown', (e) => { if (e.key === 'Enter') createBlank(); });
    }

    // 심볼 메뉴바
    els.paletteToggle.addEventListener('click', () => {
      const collapsed = els.palette.classList.toggle('is-collapsed');
      els.paletteToggle.textContent = collapsed ? '심볼 메뉴 ▾' : '심볼 메뉴 ▴';
      els.paletteToggle.setAttribute('aria-expanded', String(!collapsed));
      setTimeout(() => Canvas.fit(), 30);
    });
    els.paletteTabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pg]');
      if (!b) return;
      state.palette = b.dataset.pg;
      renderPalette();
    });
    els.paletteItems.addEventListener('click', (e) => {
      // ? 배지 — 기호 해설로 보낸다
      const help = e.target.closest('[data-help]');
      if (help) {
        e.stopPropagation();
        state.glTab = '심볼';
        els.glSearch.value = (Sym.byId(help.dataset.help) || {}).label || help.dataset.help;
        setView('glossary');
        return;
      }
      const b = e.target.closest('[data-sym]');
      if (!b) return;
      if (!state.project) return toast('먼저 도면을 여세요.', 'error');

      // 따라 그리기(펜) 모드 — 기호를 잡고 도면 위를 클릭해 찍는다
      if (els.penChk.checked) {
        Canvas.setPen(Canvas.pen === b.dataset.sym ? null : b.dataset.sym);
        renderPalette();
        if (Canvas.pen) {
          toast(`${(Sym.byId(Canvas.pen) || {}).label} 을(를) 들었습니다. 도면 위를 클릭해 찍으세요. (Esc 로 내려놓기)`, 'ok');
        }
        return;
      }
      const parent = state.project.diagram.nodes.filter((n) => n.id === Canvas.selectedId)[0] || null;
      const node = Canvas.addNode(b.dataset.sym, parent ? parent.id : null);
      if (node) {
        renderMainStrip();
        renderPalette();
        toast(`${node.name} 을(를) ${parent ? parent.name + ' 아래에' : '새 수전 계통으로'} 추가했습니다.`, 'ok');
      }
    });

    els.penChk.addEventListener('change', () => {
      if (!els.penChk.checked) Canvas.setPen(null);
      renderPalette();
    });

    // 전기도면(그림·PDF) 가져오기
    els.importDrawingBtn.addEventListener('click', () => els.drawingInput.click());
    els.drawingInput.addEventListener('change', () => {
      if (els.drawingInput.files[0]) importDrawing(els.drawingInput.files[0]);
      els.drawingInput.value = '';
    });

    // 밑그림 조작
    els.ulOpacity.addEventListener('input', () => {
      Canvas.updateUnderlay({ opacity: Number(els.ulOpacity.value) / 100 });
      markDirty();
    });
    els.ulBigger.addEventListener('click', () => { Canvas.scaleUnderlay(1.08); markDirty(); });
    els.ulSmaller.addEventListener('click', () => { Canvas.scaleUnderlay(1 / 1.08); markDirty(); });
    els.ulRemove.addEventListener('click', () => {
      if (!window.confirm('밑그림을 지울까요? 그려 넣은 설비는 그대로 남습니다.')) return;
      Canvas.setUnderlay(null);
      syncUnderlayBar();
      markDirty();
    });

    // 기호 해설
    els.glTabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-gl]');
      if (!b) return;
      state.glTab = b.dataset.gl;
      els.glSearch.value = '';
      renderGlossary();
    });
    let glTimer = null;
    els.glSearch.addEventListener('input', () => {
      clearTimeout(glTimer);
      glTimer = setTimeout(renderGlossary, 150);
    });

    // 모선 연락(TIE)
    els.tieBtn.addEventListener('click', () => {
      if (!state.project) return toast('먼저 도면을 여세요.', 'error');
      if (Canvas.tieFrom) {
        Canvas.startTie(null);
        renderPalette();
        return toast('연락 연결을 취소했습니다.', null);
      }
      if (!Canvas.selectedId) return toast('연락의 한쪽 설비를 먼저 선택하세요.', 'error');
      Canvas.startTie(Canvas.selectedId);
      renderPalette();
      toast('상대편 설비를 클릭하면 연락(TIE) 차단기가 만들어집니다. 평소 개방 상태로 들어갑니다.', 'ok');
    });
    els.frameChk.addEventListener('change', () => Canvas.setFrame(els.frameChk.checked));

    // 속성 패널의 연락 조작
    els.inspectorBody.addEventListener('click', (e) => {
      const node = state.project && state.project.diagram.nodes.filter((n) => n.id === Canvas.selectedId)[0];
      const tg = e.target.closest('[data-tie-toggle]');
      if (tg) { Canvas.toggleTie(tg.dataset.tieToggle); markDirty(); renderInspector(node); return; }
      const dl = e.target.closest('[data-tie-del]');
      if (dl) { Canvas.removeTie(dl.dataset.tieDel); markDirty(); renderInspector(node); }
    });

    // 표시 항목 메뉴
    els.measureBtn.addEventListener('click', (e) => {
      if (!state.project) return toast('먼저 도면을 여세요.', 'error');
      e.stopPropagation();
      toggleMeasureMenu();
    });
    els.measureMenu.addEventListener('click', (e) => e.stopPropagation());
    els.measureBody.addEventListener('change', (e) => {
      if (e.target.matches('input[data-measure]')) applyMeasureMenu();
    });
    els.measureResetBtn.addEventListener('click', () => {
      Canvas.setDisplayItems(Canvas.catalog().filter((m) => m.default).map((m) => m.id));
      renderMeasureMenu();
      renderMainStrip();
      markDirty();
    });
    els.measureCloseBtn.addEventListener('click', () => toggleMeasureMenu(false));
    document.addEventListener('click', () => {
      if (!els.measureMenu.hidden) toggleMeasureMenu(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!els.measureMenu.hidden) toggleMeasureMenu(false);
      if (Canvas.tieFrom) { Canvas.startTie(null); renderPalette(); }
      if (Canvas.pen) { Canvas.setPen(null); renderPalette(); }
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
        const bytes = await window.ScadaPdf.fromSvg(Canvas.toSvgString({ titleBlock: false }), {
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
      onSelect: (node) => { renderInspector(node); renderMainStrip(); renderPalette(); },
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
