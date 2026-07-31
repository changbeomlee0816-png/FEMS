/* global window */
'use strict';

/**
 * 브라우저용 XLSX 리더 — exceljs 호환 최소 구현.
 *
 * 서버는 exceljs 로 엑셀을 읽지만, 브라우저에는 그 의존성을 실을 수 없다.
 * 그래서 `server/scada/workbook.js` 가 쓰는 만큼의 API 만 똑같이 흉내낸다.
 * 덕분에 파서·검증기·도면 생성기는 **한 줄도 고치지 않고** 브라우저에서 돈다.
 *
 *   흉내내는 범위: Workbook.xlsx.load(buffer) / wb.worksheets /
 *                  ws.name · ws.rowCount · ws.actualRowCount · ws.getCell(주소).value
 *
 * xlsx 는 XML 을 담은 ZIP 이다. 압축 해제는 브라우저 내장 DecompressionStream
 * ('deflate-raw') 을 쓰므로 외부 라이브러리가 필요 없다.
 */
window.XlsxLite = (function () {
  // ── ZIP ──────────────────────────────────────────────────────────
  const SIG_EOCD = 0x06054b50;
  const SIG_CDIR = 0x02014b50;

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** ZIP 아카이브 → { 파일명: Uint8Array } */
  async function unzip(arrayBuffer) {
    const buf = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);

    // EOCD 는 끝에서부터 찾는다 (주석이 붙어 있을 수 있어 22바이트 고정이 아니다)
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (dv.getUint32(i, true) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('ZIP 구조를 찾을 수 없습니다 (xlsx 파일이 아닙니다)');

    const count = dv.getUint16(eocd + 10, true);
    let ptr = dv.getUint32(eocd + 16, true);

    const files = {};
    const decoder = new TextDecoder('utf-8');

    for (let n = 0; n < count; n++) {
      if (dv.getUint32(ptr, true) !== SIG_CDIR) break;
      const method = dv.getUint16(ptr + 10, true);
      const compSize = dv.getUint32(ptr + 20, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      const localOff = dv.getUint32(ptr + 42, true);
      const name = decoder.decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));

      // 로컬 헤더의 이름/부가필드 길이는 중앙 디렉터리와 다를 수 있다
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);

      files[name] = method === 0 ? raw : await inflateRaw(raw);
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  // ── XML ──────────────────────────────────────────────────────────
  const parser = new DOMParser();
  function xml(bytes) {
    if (!bytes) return null;
    const doc = parser.parseFromString(new TextDecoder('utf-8').decode(bytes), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('엑셀 내부 XML 을 해석할 수 없습니다');
    return doc;
  }

  /** 네임스페이스 접두사가 붙어도 잡히도록 localName 으로 찾는다 */
  function tags(node, localName) {
    return node ? Array.from(node.getElementsByTagName('*')).filter((el) => el.localName === localName) : [];
  }

  // ── 날짜 판정 ────────────────────────────────────────────────────
  // 엑셀은 날짜를 숫자로 저장하고 표시 서식(numFmt)으로만 구분한다.
  const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

  function looksLikeDateFormat(code) {
    if (!code) return false;
    // 따옴표 안의 리터럴과 색상 지정자를 제거한 뒤 날짜 토큰을 찾는다
    const stripped = String(code).replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
    return /[ymdhs]/i.test(stripped) && !/^[#0.,%\s]*$/.test(stripped);
  }

  function buildDateStyleTable(stylesDoc) {
    if (!stylesDoc) return [];
    const custom = {};
    for (const nf of tags(stylesDoc, 'numFmt')) {
      custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode');
    }
    const cellXfsNode = tags(stylesDoc, 'cellXfs')[0];
    if (!cellXfsNode) return [];
    return Array.from(cellXfsNode.children).map((xf) => {
      const id = xf.getAttribute('numFmtId');
      if (id == null) return false;
      const n = Number(id);
      if (BUILTIN_DATE_FMT.has(n)) return true;
      return looksLikeDateFormat(custom[id]);
    });
  }

  // 엑셀 serial → JS Date. 1900 윤년 버그(존재하지 않는 1900-02-29)를 보정한다.
  const EPOCH_1900 = Date.UTC(1899, 11, 30);
  function serialToDate(serial) {
    const ms = Math.round(serial * 86400 * 1000);
    return new Date(EPOCH_1900 + ms);
  }

  // ── 셀 주소 ──────────────────────────────────────────────────────
  function colToNum(col) {
    let n = 0;
    for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
    return n;
  }

  // ── 워크시트 ─────────────────────────────────────────────────────
  class Cell {
    constructor(address, value) {
      this.address = address;
      this.value = value === undefined ? null : value;
    }
  }

  class Worksheet {
    constructor(name, cells, maxRow) {
      this.name = name;
      this._cells = cells; // Map<'A1', value>
      this.rowCount = maxRow;
      this.actualRowCount = maxRow;
    }
    getCell(address) {
      return new Cell(address, this._cells.get(address));
    }
  }

  class Xlsx {
    constructor(workbook) {
      this._wb = workbook;
    }
    async load(arrayBuffer) {
      const files = await unzip(arrayBuffer);

      const wbDoc = xml(files['xl/workbook.xml']);
      if (!wbDoc) throw new Error('xl/workbook.xml 이 없습니다 (xlsx 파일이 아닙니다)');
      const relsDoc = xml(files['xl/_rels/workbook.xml.rels']);

      // r:id → 시트 파일 경로
      const target = {};
      for (const rel of tags(relsDoc, 'Relationship')) {
        let t = rel.getAttribute('Target') || '';
        t = t.replace(/^\/?xl\//, '').replace(/^\.\//, '');
        target[rel.getAttribute('Id')] = 'xl/' + t;
      }

      // 공유 문자열
      const ssDoc = xml(files['xl/sharedStrings.xml']);
      const shared = ssDoc
        ? tags(ssDoc, 'si').map((si) =>
            tags(si, 't')
              .filter((t) => t.parentNode.localName !== 'rPh') // 후리가나 제외
              .map((t) => t.textContent)
              .join('')
          )
        : [];

      const dateStyle = buildDateStyleTable(xml(files['xl/styles.xml']));

      this._wb.worksheets = [];
      const sheetsNode = tags(wbDoc, 'sheets')[0];
      const sheetEls = sheetsNode ? tags(sheetsNode, 'sheet') : [];

      let fallbackIndex = 0;
      for (const sh of sheetEls) {
        const name = sh.getAttribute('name');
        const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        fallbackIndex++;
        const path = (rid && target[rid]) || `xl/worksheets/sheet${fallbackIndex}.xml`;
        const doc = xml(files[path]);
        this._wb.worksheets.push(readSheet(name, doc, shared, dateStyle));
      }
      return this._wb;
    }
  }

  function readSheet(name, doc, shared, dateStyle) {
    const cells = new Map();
    let maxRow = 0;
    if (!doc) return new Worksheet(name, cells, 0);

    for (const c of tags(doc, 'c')) {
      const ref = c.getAttribute('r');
      if (!ref) continue;
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!m) continue;
      const row = Number(m[2]);
      if (row > maxRow) maxRow = row;

      const type = c.getAttribute('t');
      let value = null;

      if (type === 'inlineStr') {
        value = tags(c, 't').map((t) => t.textContent).join('') || null;
      } else {
        const vEl = Array.from(c.children).find((el) => el.localName === 'v');
        const raw = vEl ? vEl.textContent : null;
        if (raw == null || raw === '') {
          value = null;
        } else if (type === 's') {
          value = shared[Number(raw)] != null ? shared[Number(raw)] : null;
        } else if (type === 'str') {
          value = raw; // 수식 결과 문자열
        } else if (type === 'b') {
          value = raw === '1';
        } else if (type === 'e') {
          value = { __error: raw };
        } else {
          const num = Number(raw);
          if (Number.isFinite(num)) {
            const s = c.getAttribute('s');
            value = s != null && dateStyle[Number(s)] ? serialToDate(num) : num;
          } else {
            value = raw;
          }
        }
      }

      if (typeof value === 'string') {
        const trimmed = value.trim();
        value = trimmed === '' ? null : trimmed;
      }
      if (value !== null) cells.set(`${m[1]}${row}`, value);
    }

    // <row r="N"> 로만 존재하는 빈 행도 행 수에 반영한다
    for (const r of tags(doc, 'row')) {
      const n = Number(r.getAttribute('r'));
      if (Number.isFinite(n) && n > maxRow) maxRow = n;
    }
    return new Worksheet(name, cells, maxRow);
  }

  class Workbook {
    constructor() {
      this.worksheets = [];
      this.xlsx = new Xlsx(this);
    }
  }

  return { Workbook, unzip, colToNum };
})();
