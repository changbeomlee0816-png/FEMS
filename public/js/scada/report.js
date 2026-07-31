/* global window, document */
'use strict';

/**
 * 업로드 검증 리포트 표시.
 *
 * 요구사항 — "잘못된 부분이 있으면 정확하게 그 부분을 타겟해서 알려줄 것".
 * 그래서 모든 행은 `시트 / 셀 주소 / 항목명 / 입력된 값 / 문제 / 조치` 를
 * 한 줄에 담는다. 셀 주소는 엑셀에서 바로 Ctrl+G 로 이동할 수 있는 형태다.
 */
window.ScadaReport = (function () {
  const esc = window.ScadaSymbols.esc;

  const LEVEL_TEXT = { error: '오류', warning: '확인 필요', info: '참고' };
  const LEVEL_ICON = { error: '✕', warning: '!', info: 'i' };

  let current = { issues: [] };
  let filter = '';

  function rowHtml(it) {
    const loc = it.cell
      ? `<span class="sc-sheet">${esc(it.sheet || '')}</span><span class="sc-cell">${esc(it.cell)}</span>`
      : `<span class="sc-sheet">${esc(it.sheet || '파일')}</span>`;

    const value =
      it.value == null || it.value === ''
        ? '<span class="sc-val is-empty">(비어 있음)</span>'
        : `<span class="sc-val">${esc(it.value)}</span>`;

    return `
      <tr data-level="${it.level}">
        <td><span class="sc-lvl sc-lvl-${it.level}">${LEVEL_ICON[it.level]} ${LEVEL_TEXT[it.level]}</span></td>
        <td class="sc-loc">${loc}</td>
        <td>${esc(it.column || '-')}</td>
        <td>${value}</td>
        <td class="sc-msg">${esc(it.message)}<span class="sc-code-tag">${esc(it.code || '')}</span>
          ${it.hint ? `<span class="sc-hint">${esc(it.hint)}</span>` : ''}
        </td>
      </tr>`;
  }

  function render(report, els) {
    current = report || { issues: [] };
    const issues = current.issues || [];

    els.cntAll.textContent = issues.length;
    els.cntError.textContent = current.errorCount || 0;
    els.cntWarn.textContent = current.warningCount || 0;
    els.cntInfo.textContent = current.infoCount || 0;

    const s = current.summary || {};
    const parts = [];
    if (s.devices != null) parts.push(`장비 ${s.devices}대`);
    if (s.channels != null) parts.push(`채널 ${s.channels}개`);
    if (s.energyNodes != null) parts.push(`에너지계통 ${s.energyNodes}개`);
    if (s.mains != null) parts.push(`한전메인 ${s.mains}개`);
    if (s.products != null) parts.push(`장비 프로파일 ${s.products}종`);

    els.reportLead.innerHTML =
      (current.errorCount
        ? `<strong>오류 ${current.errorCount}건</strong>을 먼저 수정해야 도면을 만들 수 있습니다. 각 행의 <em>셀 주소</em>를 엑셀에서 그대로 찾아가 고치세요. `
        : `<strong>필수 항목 검증을 통과했습니다.</strong> `) +
      (parts.length ? `읽어들인 내용: ${parts.join(' · ')}.` : '');

    apply(els);
  }

  function apply(els) {
    const issues = (current.issues || []).filter((i) => !filter || i.level === filter);
    els.reportBody.innerHTML = issues.length
      ? issues.map(rowHtml).join('')
      : `<tr><td colspan="5" class="sc-empty">${filter ? '해당 구분의 항목이 없습니다.' : '지적된 항목이 없습니다.'}</td></tr>`;
  }

  function setFilter(level, els) {
    filter = level || '';
    apply(els);
  }

  /** 담당자에게 그대로 붙여넣어 보낼 수 있는 텍스트 */
  function asText() {
    const issues = current.issues || [];
    if (!issues.length) return '검증 결과: 지적 사항 없음';
    return issues
      .map((i) => {
        const where = i.cell ? `${i.sheet} ${i.cell}` : i.sheet || '파일';
        const val = i.value == null || i.value === '' ? '(비어 있음)' : i.value;
        return `[${LEVEL_TEXT[i.level]}] ${where} · ${i.column || '-'}\n  입력값: ${val}\n  문제: ${i.message}${i.hint ? `\n  조치: ${i.hint}` : ''}`;
      })
      .join('\n\n');
  }

  return { render, setFilter, asText };
})();
