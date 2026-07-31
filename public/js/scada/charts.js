/* global window, document */
'use strict';

/**
 * 대시보드 차트.
 *
 * 외부 라이브러리 없이 SVG 로 직접 그린다. 두 가지 형태만 쓴다:
 *  · 그룹 막대  — 계통별 "현재 부하 vs 정격" 2계열 비교
 *  · 가로 막대  — 설비그룹별 설비 수 (단일 계열, 라벨이 길어 가로가 유리)
 *
 * 색은 계열(identity)에만 쓰고, 수치·라벨은 항상 텍스트 색을 유지한다.
 */
window.ScadaCharts = (function () {
  const esc = window.ScadaSymbols.esc;

  const fmt = (v, digits) => {
    if (v == null || !isFinite(v)) return '--';
    const d = digits != null ? digits : Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
    return Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  /** 눈금 상한을 보기 좋은 값으로 올림 */
  function niceMax(v) {
    if (!v || v <= 0) return 10;
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / exp;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * exp;
  }

  function tooltip(container) {
    let el = container.querySelector('.chart-tip');
    if (!el) {
      el = document.createElement('div');
      el.className = 'chart-tip';
      el.hidden = true;
      container.appendChild(el);
    }
    return {
      show(html, x, y) {
        el.innerHTML = html;
        el.hidden = false;
        const cr = container.getBoundingClientRect();
        const tr = el.getBoundingClientRect();
        let left = x - cr.left + 12;
        if (left + tr.width > cr.width) left = x - cr.left - tr.width - 12;
        el.style.left = `${Math.max(4, left)}px`;
        el.style.top = `${Math.max(4, y - cr.top - tr.height - 8)}px`;
      },
      hide() {
        el.hidden = true;
      },
    };
  }

  /**
   * 그룹 막대 — 계통별 현재 부하 vs 정격.
   * @param {Array<{name, value, reference}>} data
   */
  function groupedBars(container, data, opts = {}) {
    const unit = opts.unit || 'kW';
    const s1 = opts.series1 || '현재 부하';
    const s2 = opts.series2 || '정격/계약전력';

    if (!data.length) {
      container.innerHTML = '<p class="sc-empty">표시할 계통이 없습니다.</p>';
      return;
    }

    const W = Math.max(container.clientWidth || 640, 360);
    const padL = 52;
    const padR = 12;
    const padT = 26; // 상단 눈금 라벨과 단위 표기가 겹치지 않도록 확보
    const padB = 46;
    const H = 260;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const max = niceMax(Math.max(...data.flatMap((d) => [d.value || 0, d.reference || 0]), 1));
    const slot = plotW / data.length;
    const barW = Math.min(26, Math.max(9, slot / 3.2));
    const GAP = 2; // 인접 막대 사이 표면 간격
    const y = (v) => padT + plotH - (Math.max(0, v) / max) * plotH;

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);
    let svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s1)} 및 ${esc(s2)} 비교">`;

    for (const t of ticks) {
      svg += `<line class="chart-grid" x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}" />
              <text class="chart-axis chart-axis-y" x="${padL - 8}" y="${y(t) + 3.5}">${fmt(t, 0)}</text>`;
    }

    data.forEach((d, i) => {
      const cx = padL + slot * i + slot / 2;
      const x1 = cx - barW - GAP / 2;
      const x2 = cx + GAP / 2;
      const h1 = padT + plotH - y(d.value || 0);
      const h2 = padT + plotH - y(d.reference || 0);

      if (d.reference)
        svg += `<rect class="chart-bar chart-bar-2" x="${x2}" y="${y(d.reference)}" width="${barW}" height="${Math.max(0, h2)}" />`;
      svg += `<rect class="chart-bar chart-bar-1" x="${x1}" y="${y(d.value || 0)}" width="${barW}" height="${Math.max(0, h1)}" />`;

      const label = d.name.length > 8 ? d.name.slice(0, 7) + '…' : d.name;
      svg += `<text class="chart-label" x="${cx}" y="${H - padB + 17}" text-anchor="middle">${esc(label)}</text>`;
      // 직접 라벨은 주계열(현재 부하)에만 — 모든 점에 숫자를 찍지 않는다
      if (d.value != null)
        svg += `<text class="chart-value" x="${x1 + barW / 2}" y="${y(d.value) - 5}" text-anchor="middle">${fmt(d.value)}</text>`;

      svg += `<rect class="chart-hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${plotH}" data-i="${i}" />`;
    });

    svg += `<text class="chart-axis" x="${padL - 8}" y="${padT - 12}" text-anchor="end">${esc(unit)}</text></svg>`;

    // 정격이 하나도 설정되지 않았으면 그 계열은 범례에서 뺀다 — 없는 막대를
    // 범례에만 남겨두면 "왜 안 보이지?" 하는 오해를 만든다.
    const hasRef = data.some((d) => d.reference > 0);
    container.innerHTML =
      `<div class="chart-legend">
         <span><i style="background:var(--series-1)"></i>${esc(s1)}</span>
         ${hasRef
           ? `<span><i style="background:var(--series-2)"></i>${esc(s2)}</span>`
           : `<span class="sc-muted">${esc(s2)} 미설정 — 도면에서 설비를 선택해 정격출력을 입력하세요</span>`}
       </div>` + svg;
    container.style.position = 'relative';

    const tip = tooltip(container);
    container.querySelectorAll('.chart-hit').forEach((hit) => {
      hit.addEventListener('mousemove', (e) => {
        const d = data[Number(hit.dataset.i)];
        tip.show(
          `<b>${esc(d.name)}</b>
           <div class="tip-row"><i style="background:var(--series-1)"></i>${esc(s1)} <b>${fmt(d.value)}</b> ${esc(unit)}</div>
           <div class="tip-row"><i style="background:var(--series-2)"></i>${esc(s2)} <b>${fmt(d.reference)}</b> ${esc(unit)}</div>`,
          e.clientX,
          e.clientY
        );
      });
      hit.addEventListener('mouseleave', () => tip.hide());
    });
  }

  /**
   * 가로 막대 — 단일 계열. 라벨이 긴 범주(설비그룹명)에 적합.
   * @param {Array<{name, value}>} data
   */
  function horizontalBars(container, data, opts = {}) {
    const unit = opts.unit || '개';
    if (!data.length) {
      container.innerHTML = '<p class="sc-empty">설비그룹이 없습니다.</p>';
      return;
    }

    const rowH = 28;
    const W = Math.max(container.clientWidth || 320, 240);
    const padL = Math.min(112, Math.max(64, W * 0.32));
    const padR = 44;
    const H = data.length * rowH + 10;
    const plotW = W - padL - padR;
    const max = Math.max(...data.map((d) => d.value || 0), 1);

    let svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || '항목별 수량')}">`;
    data.forEach((d, i) => {
      const y = i * rowH + 6;
      const w = ((d.value || 0) / max) * plotW;
      const label = d.name.length > 10 ? d.name.slice(0, 9) + '…' : d.name;
      svg += `
        <text class="chart-label" x="${padL - 8}" y="${y + 12}" text-anchor="end">${esc(label)}</text>
        <rect class="chart-bar chart-bar-2" x="${padL}" y="${y + 2}" width="${Math.max(2, w)}" height="${rowH - 12}" />
        <text class="chart-value" x="${padL + Math.max(2, w) + 7}" y="${y + 12}">${fmt(d.value, 0)}</text>
        <rect class="chart-hit" x="0" y="${y - 2}" width="${W}" height="${rowH}" data-i="${i}" />`;
    });
    svg += '</svg>';

    container.innerHTML = svg;
    container.style.position = 'relative';

    const tip = tooltip(container);
    container.querySelectorAll('.chart-hit').forEach((hit) => {
      hit.addEventListener('mousemove', (e) => {
        const d = data[Number(hit.dataset.i)];
        tip.show(`<b>${esc(d.name)}</b><div class="tip-row">${fmt(d.value, 0)} ${esc(unit)}</div>`, e.clientX, e.clientY);
      });
      hit.addEventListener('mouseleave', () => tip.hide());
    });
  }

  return { groupedBars, horizontalBars, fmt };
})();
