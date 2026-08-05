'use strict';

/**
 * 단일 HTML 빌드 — 서버 없이 브라우저에서 그대로 도는 SCADA 도면 제작기.
 *
 * 핵심은 **서버 로직을 복사하지 않는다**는 것이다. `server/scada/*.js` 를
 * 있는 그대로 읽어 CommonJS 셈(shim)으로 감싸 넣는다. exceljs 만 브라우저용
 * XLSX 리더(xlsx-lite.js)로 갈아끼우고, 서버 호출 계층(api.js)은 같은
 * 인터페이스의 로컬 구현(local-api.js)으로 대체한다.
 *
 *   → 검증 규칙이나 배치 알고리즘을 서버에서 고치면 이 빌드에도 그대로 반영된다.
 *
 * 출력은 두 가지다.
 *   기본        — 완전한 HTML 문서. 정적 호스팅(GitHub Pages)이나 파일 더블클릭용.
 *   --fragment  — <head> 없이 본문만. 문서 골격을 host 가 씌워주는 환경(Claude 아티팩트)용.
 *
 * `<meta charset="utf-8">` 이 빠지면 브라우저가 latin-1 로 읽어 스크립트 안의
 * 한글 시트명 리터럴이 깨지고, 그 결과 시트 매칭이 전부 실패한다. 기본 출력이
 * 완전한 문서인 이유다.
 *
 * 실행: node tools/build-standalone.js [출력경로] [--fragment]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 브라우저에서 돌릴 서버 모듈 (store.js 는 DB 의존이라 제외 — local-api.js 가 대신한다) */
const SERVER_MODULES = ['schema', 'codes', 'workbook', 'parser', 'validator', 'model', 'diagram', 'blank', 'importer'];

function cjsShim() {
  return `
/* ── CommonJS 셈 ─────────────────────────────────────────────────
   server/scada/*.js 를 수정 없이 브라우저에서 돌리기 위한 최소 모듈 시스템. */
var __defs = {}, __cache = {};
function __def(name, factory) { __defs[name] = factory; }
function __req(name) {
  var key = String(name).replace(/^\\.\\//, '').replace(/^.*\\//, '');
  if (__cache[key]) return __cache[key].exports;
  var factory = __defs[key];
  if (!factory) throw new Error('모듈을 찾을 수 없습니다: ' + name);
  var mod = { exports: {} };
  __cache[key] = mod;
  factory(mod, mod.exports, __req);
  return mod.exports;
}

/* exceljs 자리에 브라우저 XLSX 리더를 끼운다.
   server/scada/workbook.js 가 쓰는 API 만 동일하게 제공하면 된다. */
__def('exceljs', function (module) {
  module.exports = { Workbook: window.XlsxLite.Workbook };
});
`;
}

function wrapModule(name, source) {
  return `__def(${JSON.stringify(name)}, function (module, exports, require) {\n${source}\n});\n`;
}

async function build(outPath, opts = {}) {
  // ── 1) 서버 로직 번들 ──────────────────────────────────────────
  const bundle = [cjsShim()];
  for (const name of SERVER_MODULES) {
    bundle.push(wrapModule(name, read(`server/scada/${name}.js`)));
  }

  // ── 2) 화면 코드 (서버판과 동일 파일) ──────────────────────────
  const ui = ['xlsx-lite', 'symbols', 'charts', 'report', 'pdf', 'alarms', 'glossary', 'drawing-import', 'canvas'].map((n) => read(`public/js/scada/${n}.js`));

  // ── 3) 샘플 엑셀 (링크만 받은 사람도 바로 시험해 볼 수 있도록) ──
  const samples = {};
  for (const n of ['sample-good', 'sample-broken']) {
    const p = path.join(ROOT, 'test/fixtures', `${n}.xlsx`);
    if (fs.existsSync(p)) samples[n] = fs.readFileSync(p).toString('base64');
  }
  if (!samples['sample-good']) {
    throw new Error('샘플 엑셀이 없습니다. 먼저 `npm run sample` 을 실행하세요.');
  }

  // ── 3-2) 양식 (브라우저에는 exceljs 가 없으므로 빌드 시 만들어 embed) ──
  const { templateBuffer } = require('../server/scada/template');
  const templates = {
    example: Buffer.from(await templateBuffer({ mode: 'example' })).toString('base64'),
    blank: Buffer.from(await templateBuffer({ mode: 'blank' })).toString('base64'),
  };

  // ── 4) 마크업: public/scada.html 의 body 안쪽을 그대로 사용 ────
  const html = read('public/scada.html');
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (!bodyMatch) throw new Error('public/scada.html 에서 body 를 찾을 수 없습니다.');
  let markup = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '').trim();

  // 단독 실행 안내 + 샘플 내려받기 줄을 업로드 화면에 끼워 넣는다
  const standaloneBar = `
      <div class="sc-standalone">
        <div class="sc-standalone-main">
          <strong>브라우저에서 그대로 동작합니다.</strong>
          엑셀 해석·검증·도면 생성이 모두 이 화면 안에서 실행되고, 만든 도면은 이 브라우저에 저장됩니다.
          서버 설치 없이 바로 쓰세요.
        </div>
        <div class="sc-tool-group">
          <button class="sc-btn sc-btn-ghost" id="dlGood">샘플 엑셀 받기</button>
          <button class="sc-btn sc-btn-ghost" id="dlBroken">오류 예시 받기</button>
        </div>
      </div>`;
  markup = markup.replace(
    '<div class="sc-upload-grid">',
    `${standaloneBar}\n      <div class="sc-upload-grid">`
  );

  const css = read('public/css/scada.css');

  // ── 5) head / body 를 처음부터 나눠서 만든다 ──────────────────
  const headHtml = `<title>FEMS SCADA 도면 제작</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230b1120'/%3E%3Cpath d='M17 6l-7 11h5l-1 9 7-11h-5z' fill='%2335d0a5'/%3E%3C/svg%3E" />
<style>
${css}

/* ── 단독 실행 빌드 전용 ─────────────────────────────────────────
   계전반 화면이라 라이트/다크 어느 쪽에서 열어도 어두운 관제 배색을
   유지한다 (프로그램 화면·SVG 내보내기 결과와 같은 색). */
html, body { margin: 0; padding: 0; background: #0b1120; }
.scada { min-height: 100vh; }

.sc-standalone {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap;
  max-width: 1500px; margin: 0 auto 16px;
  padding: 12px 16px;
  background: var(--surface-1); border: 1px solid var(--line);
  border-left: 3px solid var(--wire-live); border-radius: 8px;
}
.sc-standalone-main { font-size: 13.2px; color: var(--text-secondary); max-width: 82ch; }
.sc-standalone-main strong { color: var(--text-primary); font-weight: 650; }
</style>`;

  const bodyHtml = `<div class="scada">
${markup}
</div>

<script>
${bundle.join('\n')}
</script>

<script>
${ui.join('\n\n')}
</script>

<script>
/* 양식은 빌드 시 server/scada/template.js 로 만들어 여기에 실어 둔다 */
window.SCADA_TEMPLATES = ${JSON.stringify(templates)};
</script>

<script>
/* 로컬 백엔드를 서버 API 자리에 끼운다 — 화면 코드는 차이를 모른다 */
${read('public/js/scada/local-api.js')}
window.ScadaApi = window.ScadaLocalApi(__req);
</script>

<script>
/* 샘플 엑셀 내려받기 */
(function () {
  var SAMPLES = ${JSON.stringify(samples)};
  function toBytes(b64) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  async function grab(key, filename) {
    var bytes = toBytes(SAMPLES[key]);
    if (window.claude && window.claude.downloads) {
      try {
        await window.claude.downloads.save({ filename: filename, data: bytes });
        return;
      } catch (e) {
        if (e && e.code === 'user_rejected') return;
      }
    }
    var url = URL.createObjectURL(new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }));
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }
  var g = document.getElementById('dlGood');
  var b = document.getElementById('dlBroken');
  if (g) g.addEventListener('click', function () { grab('sample-good', 'FEMS_수용가등록_샘플.xlsx'); });
  if (b) b.addEventListener('click', function () { grab('sample-broken', 'FEMS_수용가등록_오류예시.xlsx'); });
})();
</script>

<script>
${read('public/js/scada/app.js')}
</script>`;

  // 아티팩트처럼 host 가 문서 골격을 씌워주는 환경에서는 본문만 내보낸다.
  // 그 외에는 charset 을 포함한 완전한 문서여야 한다.
  const out = opts.fragment
    ? `${headHtml}\n\n${bodyHtml}\n`
    : `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="FEMS 수용가 등록 엑셀을 올리면 SCADA 단선결선도를 만들어 주는 도구" />
${headHtml}
</head>
<body>
${bodyHtml}
</body>
</html>
`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out);
  return { outPath, bytes: out.length, fragment: !!opts.fragment };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const fragment = args.includes('--fragment');
  const out = args.filter((a) => !a.startsWith('--'))[0] || path.join(ROOT, 'dist', 'scada-standalone.html');
  build(out, { fragment })
    .then((r) => console.log(`빌드 완료: ${r.outPath} (${Math.round(r.bytes / 1024)}KB${r.fragment ? ', fragment' : ''})`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { build };
