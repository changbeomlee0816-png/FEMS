/* global window, TextDecoder, DecompressionStream, Response */
'use strict';

/**
 * 전기도면(이미지 · PDF) **읽기**.
 *
 * 이 파일은 파일에서 재료를 꺼내는 데까지만 한다.
 *   - 페이지 그림(pages) — AI 판독에 보낼 이미지이자 캔버스 밑그림
 *   - 글자와 좌표(tokens) — 벡터 PDF 일 때만 나온다
 *
 * 계통을 실제로 **읽어 내는 일은 vision.js(AI 판독)** 가 맡는다.
 * 여기 남은 규칙 기반 인식(detect · buildTree)은 AI 를 쓸 수 없을 때
 * (키가 없거나 통신이 막혔을 때) 벡터 PDF 에서만 동작하는 보조 수단이다.
 *
 * 외부 라이브러리를 쓰지 않는다 — PDF 는 직접 읽는다(브라우저 CSP 제약).
 */
window.ScadaDrawingImport = (function () {
  const latin1 = new TextDecoder('latin1');

  // ── 유틸 ───────────────────────────────────────────────────────
  function indexOfBytes(buf, pattern, from) {
    const pat = typeof pattern === 'string' ? pattern.split('').map((c) => c.charCodeAt(0)) : pattern;
    outer: for (let i = from || 0; i <= buf.length - pat.length; i++) {
      for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
      return i;
    }
    return -1;
  }

  async function inflate(bytes) {
    // FlateDecode = zlib. 헤더가 없으면 raw deflate 로 한 번 더 시도한다.
    for (const fmt of ['deflate', 'deflate-raw']) {
      try {
        const ds = new DecompressionStream(fmt);
        const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
        if (buf.byteLength) return new Uint8Array(buf);
      } catch (e) {
        /* 다음 형식으로 */
      }
    }
    return null;
  }

  function toDataUrl(bytes, mime) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(bin)}`;
  }

  // ── PDF 읽기 ───────────────────────────────────────────────────
  /**
   * PDF 안의 모든 스트림 객체를 훑는다.
   * 정식 xref 를 따라가지 않고 `obj … endobj` 를 직접 스캔한다.
   * (현장 도면 PDF 는 xref 가 깨져 있는 경우가 흔해서 이 편이 더 잘 읽힌다)
   */
  async function readPdf(bytes) {
    const raw = latin1.decode(bytes);
    const images = [];
    const contents = [];

    const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = objRe.exec(raw))) {
      const start = m.index;
      const endIdx = raw.indexOf('endobj', start);
      if (endIdx < 0) continue;
      const sIdx = raw.indexOf('stream', start);
      if (sIdx < 0 || sIdx > endIdx) continue;

      const dict = raw.slice(start, sIdx);
      let dataStart = sIdx + 6;
      if (raw[dataStart] === '\r') dataStart++;
      if (raw[dataStart] === '\n') dataStart++;
      let dataEnd = raw.indexOf('endstream', dataStart);
      if (dataEnd < 0) continue;
      while (dataEnd > dataStart && (raw[dataEnd - 1] === '\n' || raw[dataEnd - 1] === '\r')) dataEnd--;
      const data = bytes.subarray(dataStart, dataEnd);

      if (/\/Subtype\s*\/Image/.test(dict)) {
        const w = Number((/\/Width\s+(\d+)/.exec(dict) || [])[1] || 0);
        const h = Number((/\/Height\s+(\d+)/.exec(dict) || [])[1] || 0);
        if (/\/DCTDecode/.test(dict)) images.push({ w, h, mime: 'image/jpeg', data });
        else if (/\/JPXDecode/.test(dict)) images.push({ w, h, mime: 'image/jp2', data });
        // 그 외 인코딩(CCITT·Flate 원본 픽셀)은 브라우저가 바로 못 그리므로 건너뛴다
      } else if (!/\/Subtype\s*\/(Type1|TrueType|Type0|CIDFont|Form)/.test(dict)) {
        contents.push({ flate: /\/FlateDecode/.test(dict), data });
      }
    }

    // 페이지 크기 (텍스트 y 좌표를 위에서부터로 뒤집을 때 쓴다)
    const mb = /\/MediaBox\s*\[\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)/.exec(raw);
    const page = mb
      ? { w: Math.abs(Number(mb[3]) - Number(mb[1])), h: Math.abs(Number(mb[4]) - Number(mb[2])) }
      : { w: 842, h: 595 };

    // 텍스트 토큰
    const tokens = [];
    for (const c of contents) {
      let body = c.data;
      if (c.flate) {
        body = await inflate(c.data);
        if (!body) continue;
      }
      const text = latin1.decode(body);
      if (text.indexOf('BT') < 0) continue;
      collectText(text, page, tokens);
    }

    // 페이지 그림 — 스캔 도면은 페이지 하나가 통째로 이미지 한 장이다.
    // 여러 장짜리 도면은 한 계통이 장을 넘겨 이어지므로 큰 것들을 모두 넘긴다.
    images.sort((a, b) => b.w * b.h - a.w * a.h);
    const drawable = images.filter((im) => im.mime === 'image/jpeg');
    const biggest = drawable.length ? drawable[0].w * drawable[0].h : 0;
    const pages = drawable
      .filter((im) => im.w * im.h >= biggest * 0.4) // 로고·표제란 조각은 뺀다
      .slice(0, 4)
      .map((im) => ({ dataUrl: toDataUrl(im.data, 'image/jpeg'), w: im.w, h: im.h }));

    return { kind: 'pdf', tokens, underlay: pages[0] || null, pages, page, imageCount: images.length };
  }

  /** 콘텐츠 스트림에서 글자와 위치를 뽑는다 (Tm/Td/TD/T* + Tj/TJ/'/") */
  function collectText(text, page, out) {
    const blocks = text.split(/\bBT\b/).slice(1);
    for (const blk of blocks) {
      const body = blk.split(/\bET\b/)[0];
      let x = 0;
      let y = 0;
      let lineX = 0;
      let lineY = 0;
      const opRe = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|(-?[\d.]+)\s+(-?[\d.]+)\s+(TD|Td)|\bT\*|\((?:\\.|[^\\()])*\)\s*(?:Tj|')|\[(?:[^\][]|\\.)*\]\s*TJ|<[0-9A-Fa-f\s]*>\s*Tj/g;
      let mm;
      while ((mm = opRe.exec(body))) {
        const s = mm[0];
        if (/Tm$/.test(s)) {
          x = lineX = Number(mm[5]);
          y = lineY = Number(mm[6]);
        } else if (/(TD|Td)$/.test(s)) {
          lineX += Number(mm[7]);
          lineY += Number(mm[8]);
          x = lineX;
          y = lineY;
        } else if (/^T\*/.test(s)) {
          lineY -= 12;
          x = lineX;
          y = lineY;
        } else {
          const str = decodeShown(s);
          if (str && str.trim()) out.push({ text: str.trim(), x, y: page.h - y });
        }
      }
    }
  }

  function decodeShown(op) {
    if (op[0] === '<') {
      const hex = op.slice(1, op.indexOf('>')).replace(/\s+/g, '');
      let s = '';
      for (let i = 0; i + 1 < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      return s;
    }
    const parts = op.match(/\((?:\\.|[^\\()])*\)/g) || [];
    return parts
      .map((p) =>
        p
          .slice(1, -1)
          .replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '', t: ' ', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[c]))
          .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
      )
      .join('');
  }

  // ── 이미지 읽기 ────────────────────────────────────────────────
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const underlay = { dataUrl: String(fr.result), w: img.naturalWidth, h: img.naturalHeight };
          resolve({ kind: 'image', tokens: [], underlay, pages: [underlay] });
        };
        img.onerror = () => reject(new Error('이미지 형식을 인식하지 못했습니다.'));
        img.src = String(fr.result);
      };
      fr.readAsDataURL(file);
    });
  }

  // ── 기기 인식 사전 ─────────────────────────────────────────────
  /**
   * 도면 글자 → 기기.
   * 앞에서부터 먼저 맞는 규칙을 쓰므로, 구체적인 것을 위에 둔다.
   */
  const RULES = [
    { re: /KEPCO|INCOMING|한전\s*인입|수전점/i, symbol: 'utility', name: '한전 수전점', root: true },
    { re: /DIESEL\s*GEN|GENERATOR|발전기/i, symbol: 'generator', name: '발전기' },
    { re: /\bMOF\b|계기용변성기/i, symbol: 'mof', name: 'MOF' },
    { re: /\bLA\b\s*-?\s*\d|피뢰기|LIGHTNING\s*ARRESTER/i, symbol: 'la', name: '피뢰기' },
    { re: /SURGE\s*ABSORBER|서지흡수/i, symbol: 'sa', name: '서지흡수기' },
    { re: /\bLDS\b|\bLBS\b|부하개폐기/i, symbol: 'lbs', name: 'LBS' },
    { re: /\bDS\b(?!\w)|단로기|DISCONNECT/i, symbol: 'switch', name: '단로기' },
    { re: /POWER\s*FUSE|\bPF\s*-?\s*\d|전력퓨즈/i, symbol: 'fuse', name: '전력퓨즈' },
    { re: /\bCOS\b|컷아웃/i, symbol: 'cos', name: 'COS' },
    { re: /\bVCB\b|진공차단기|V\.?\s?C\.?\s?B/i, symbol: 'vcb', name: 'VCB' },
    { re: /\bACB\b|기중차단기/i, symbol: 'acb', name: 'ACB' },
    { re: /\bGCB\b|가스차단기/i, symbol: 'gcb', name: 'GCB' },
    { re: /\bELCB\b|\bELB\b|누전차단기/i, symbol: 'elcb', name: 'ELCB' },
    { re: /\bMCCB\b|배선용차단기/i, symbol: 'mccb', name: 'MCCB' },
    { re: /\bATS\b|자동절체/i, symbol: 'ats', name: 'ATS' },
    { re: /TRANSFORMER|\bTR\s*-?\s*\d|변압기/i, symbol: 'transformer', name: '변압기' },
    { re: /\bZCT\b|영상변류기/i, symbol: 'zct', name: 'ZCT' },
    { re: /\bCT\s*-?\s*\d|\bCT\b\s*\d+\s*\/|변류기/i, symbol: 'ct', name: 'CT' },
    { re: /\bPT\b|계기용변압기/i, symbol: 'pt', name: 'PT' },
    { re: /\bSC\b\s*\d|콘덴서|CAPACITOR/i, symbol: 'capacitor', name: '콘덴서' },
    { re: /\bSR\b\s*\d|리액터|REACTOR/i, symbol: 'reactor', name: '직렬리액터' },
    { re: /\bUPS\b/i, symbol: 'ups', name: 'UPS' },
    { re: /\bESS\b|배터리|BATTERY/i, symbol: 'ess', name: 'ESS' },
    { re: /태양광|\bPV\b|SOLAR/i, symbol: 'pv', name: '태양광' },
    { re: /\bMCC\b|전동기제어반/i, symbol: 'panel', name: 'MCC' },
    { re: /\bAHU\b|공조기/i, symbol: 'ahu', name: '공조기' },
    { re: /CHILLER|냉동기/i, symbol: 'chiller', name: '냉동기' },
    { re: /COMPRESSOR|압축기/i, symbol: 'compressor', name: '공기압축기' },
    { re: /\bPUMP\b|펌프/i, symbol: 'pump', name: '펌프' },
    { re: /\bFAN\b|송풍기/i, symbol: 'fan', name: '송풍기' },
    { re: /\bMOTOR\b|전동기/i, symbol: 'motor', name: '전동기' },
    { re: /^(LM|LP)\s*-/i, symbol: 'lighting', name: '전등·전열 회로' },
    { re: /^PM\s*-/i, symbol: 'panel', name: '동력 회로' },
    { re: /SPARE|예비/i, symbol: 'load', name: '예비 회로', skip: true },
  ];

  /** 정격 표기 파싱 — `25.8KV 200AF (85AT)`, `3P 225/200`, `300KVA`, `12.5KA` */
  function parseSpec(text) {
    const out = {};
    let m;
    if ((m = /(\d+(?:\.\d+)?)\s*KV/i.exec(text))) out.voltage = Number(m[1]);
    if ((m = /(\d+(?:\.\d+)?)\s*KA/i.exec(text))) out.breakingCapacity = Number(m[1]);
    if ((m = /(\d+(?:,\d{3})*)\s*KVA/i.exec(text))) out.capacityKva = Number(m[1].replace(/,/g, ''));
    if ((m = /(\d+(?:,\d{3})*)\s*KW/i.exec(text))) out.ratedPower = Number(m[1].replace(/,/g, ''));
    // 225/200 → AF/AT, 40/5A → CT비
    if ((m = /(\d+)\s*\/\s*(\d+)\s*A?T?\b/.exec(text))) {
      out.frame = Number(m[1]);
      out.trip = Number(m[2]);
    }
    if ((m = /(\d+)\s*AT\b/i.exec(text))) out.trip = Number(m[1]);
    if ((m = /(\d+)\s*AF\b/i.exec(text))) out.frame = Number(m[1]);
    if (out.trip == null && (m = /\b(\d{2,4})\s*A\b/.exec(text))) out.trip = Number(m[1]);
    if ((m = /\b(\d)\s*P\b/.exec(text))) out.poles = Number(m[1]);
    if ((m = /\b([A-Z]{2,4}\s*-\s*\d{1,3})\b/.exec(text))) out.tag = m[1].replace(/\s+/g, '');
    return out;
  }

  /**
   * 토큰 → 기기 후보.
   * 한 기기의 표기가 여러 줄로 나뉘어 있는 일이 많아, 같은 위치의 줄을 묶어 본다.
   */
  function detect(tokens) {
    // 가까운 줄끼리 묶기 (같은 x 대역 · y 20pt 이내)
    const lines = tokens.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const groups = [];
    for (const t of lines) {
      const g = groups.filter((x) => Math.abs(x.y - t.y) < 22 && Math.abs(x.x - t.x) < 130)[0];
      if (g) {
        g.text += ' ' + t.text;
        g.y = (g.y + t.y) / 2;
        g.x = Math.min(g.x, t.x);
      } else {
        groups.push({ text: t.text, x: t.x, y: t.y });
      }
    }

    const found = [];
    for (const g of groups) {
      for (const rule of RULES) {
        if (!rule.re.test(g.text)) continue;
        if (rule.skip) break;
        const spec = parseSpec(g.text);
        found.push({
          symbol: rule.symbol,
          root: !!rule.root,
          name: spec.tag || rule.name,
          label: g.text.replace(/\s+/g, ' ').slice(0, 60),
          x: g.x,
          y: g.y,
          spec,
          use: true,
        });
        break;
      }
    }
    return found;
  }

  /**
   * 인식 결과 → 계통 트리.
   *
   * 단선결선도는 위에서 아래로 전력이 흐른다는 것 하나로 층을 잡는다.
   *  1) 수전점(없으면 만들어 준다)
   *  2) 변압기 위쪽 특고압 기기들 → 세로 순서대로 직렬
   *  3) 변압기들 → 특고압 최하단 기기 아래로
   *  4) 변압기 아래 저압 기기 → x 가 가장 가까운 변압기의 자식
   */
  function buildTree(items) {
    const use = items.filter((i) => i.use);
    if (!use.length) return [];
    const trs = use.filter((i) => i.symbol === 'transformer').sort((a, b) => a.x - b.x);
    const trY = trs.length ? Math.min(...trs.map((t) => t.y)) : Infinity;

    const mv = use.filter((i) => i.symbol !== 'transformer' && i.y < trY).sort((a, b) => a.y - b.y);
    const lv = use.filter((i) => i.symbol !== 'transformer' && i.y > trY).sort((a, b) => a.y - b.y || a.x - b.x);

    const nodes = [];
    let seq = 0;
    const add = (item, parent) => {
      const n = { key: `k${++seq}`, parent: parent ? parent.key : null, ...item };
      nodes.push(n);
      return n;
    };

    // 1) 수전점
    let root = mv.filter((i) => i.root)[0];
    if (root) mv.splice(mv.indexOf(root), 1);
    else root = { symbol: 'utility', name: '한전 수전점', label: '(자동 추가)', spec: {}, x: 0, y: 0 };
    const rootNode = add(root, null);

    // 2) 특고압 직렬
    let cur = rootNode;
    for (const item of mv) cur = add(item, cur);

    // 3) 변압기
    const trNodes = trs.map((t) => add(t, cur));

    // 4) 저압 — x 가 가장 가까운 변압기 아래로
    for (const item of lv) {
      if (!trNodes.length) { add(item, cur); continue; }
      let best = trNodes[0];
      let bd = Infinity;
      for (const t of trNodes) {
        const d = Math.abs(t.x - item.x);
        if (d < bd) { bd = d; best = t; }
      }
      add(item, best);
    }
    return nodes;
  }

  /** 파일 하나를 읽어 { kind, underlay, tokens, items } 로 돌려준다 */
  async function read(file) {
    if (!file) throw new Error('파일이 없습니다.');
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const res = isPdf ? await readPdf(new Uint8Array(await file.arrayBuffer())) : await readImage(file);
    res.items = detect(res.tokens || []);
    res.filename = file.name;
    return res;
  }

  return { read, readPdf, detect, buildTree, parseSpec, RULES };
})();
